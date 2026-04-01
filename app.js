/**
 * 智己汽车 - 试驾邀约POC (V5.4-Fix)
 * 
 * 核心修复：
 * 1. 正确处理CSV数据结构（每行=一通电话=一个segment）
 * 2. 修复图谱构建逻辑，确保生成transitions边
 * 3. 重构D3可视化，使用分层布局
 */

// ============================================
// 全局状态
// ============================================
const AppState = {
    currentUser: null,
    currentPage: 'dashboard',
    graphData: null,
    staResults: [],
    currentTopicId: 'S1-T1-1',
    conversationHistory: [],
    isProcessing: false
};

// Stage定义（颜色）
const STAGE_DEF = {
    S1: { name: '开场破冰', color: '#1E88E5' },
    S2: { name: '需求挖掘', color: '#00ACC1' },
    S3: { name: '产品价值传递', color: '#4CAF50' },
    S4: { name: '异议处理', color: '#FFC107' },
    S5: { name: '邀约收口', color: '#9C27B0' }
};

// ============================================
// 编码检测与解码
// ============================================
function detectAndDecode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let highBytes = 0;
    const sampleSize = Math.min(bytes.length, 1000);
    
    for (let i = 0; i < sampleSize; i++) {
        if (bytes[i] > 0x80) highBytes++;
    }
    
    const isGBK = highBytes > (sampleSize * 0.05);
    
    if (isGBK) {
        try {
            return new TextDecoder('gbk', { fatal: true }).decode(arrayBuffer);
        } catch (e) {
            console.warn('GBK解码失败，回退到UTF-8:', e);
        }
    }
    
    return new TextDecoder('utf-8').decode(arrayBuffer);
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof d3 === 'undefined') {
        document.body.innerHTML = '<div style="padding:50px;text-align:center;">D3.js加载失败</div>';
        return;
    }
    initApp();
});

function initApp() {
    document.getElementById('login-page')?.classList.add('active');
    document.getElementById('app')?.classList.remove('active');
    
    try {
        const saved = localStorage.getItem('zhiji_sta_v5');
        if (saved) {
            const parsed = JSON.parse(saved);
            AppState.graphData = parsed.graphData || null;
            console.log('从localStorage恢复:', AppState.graphData?.nodes?.length || 0, '节点');
        }
    } catch (e) {
        console.error('恢复数据失败', e);
    }
    
    updateDashboardStats();
}

// ============================================
// 登录与导航
// ============================================
function login() {
    const account = document.getElementById('login-account')?.value;
    const password = document.getElementById('login-password')?.value;
    
    if (account === 'demo' && password === 'demo') {
        AppState.currentUser = { account };
        document.getElementById('login-page')?.classList.remove('active');
        document.getElementById('app')?.classList.add('active');
        navigateTo('dashboard');
    } else {
        alert('账号或密码错误');
    }
}

function navigateTo(page) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${page}"]`)?.classList.add('active');
    
    document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    
    AppState.currentPage = page;
    
    if (page === 'graph' && AppState.graphData) {
        setTimeout(renderGraphV5, 50);
    } else if (page === 'guide') {
        initGuidePage();
    } else if (page === 'dashboard') {
        updateDashboardStats();
    }
}

// ============================================
// 文件上传与解析（V5.4修复版）
// ============================================
function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    showLoading(`正在解析 ${file.name}...`);
    AppState.isProcessing = true;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let rows = [];
            
            if (file.name.endsWith('.csv')) {
                const arrayBuffer = e.target.result;
                const text = detectAndDecode(arrayBuffer);
                rows = parseCSVAdvanced(text);
                console.log('CSV解析完成，共', rows.length, '行');
            } else if (file.name.endsWith('.xlsx')) {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(sheet);
            }
            
            // 处理数据并构建图谱
            await processData(rows, (progress, total) => {
                updateLoadingText(`正在分析: ${progress}/${total}`);
            });
            
            hideLoading();
            setTimeout(() => navigateTo('graph'), 500);
        } catch (err) {
            hideLoading();
            showNotification('解析失败: ' + err.message, 'error');
            console.error(err);
        } finally {
            AppState.isProcessing = false;
        }
    };
    
    if (file.name.endsWith('.xlsx')) {
        reader.readAsBinaryString(file);
    } else {
        reader.readAsArrayBuffer(file);
    }
}

/**
 * 高级CSV解析 - 正确处理引号和编码
 */
function parseCSVAdvanced(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length) continue;
        
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });
        
        // 只保留有call_id和asr的行
        if (row.call_id && row.call_id.trim() && row.asr && row.asr.trim()) {
            rows.push(row);
        }
    }
    
    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

/**
 * 处理数据 - 每行转换为STA结构
 */
async function processData(rows, onProgress) {
    const staResults = [];
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        // 解析asr文本中的时间戳和角色
        const parsed = parseASRAdvanced(row.asr);
        
        // 为每个发言创建segment
        const segments = parsed.messages.map((msg, idx) => {
            const stage = detectStage(msg.content, idx);
            const topic = detectTopic(msg.content, stage);
            const act = detectAct(msg.content, msg.role);
            
            // 计算跳转类型
            let jumpType = 'A'; // 初始
            if (idx > 0) {
                const prevStage = segments[idx - 1]?.stage || 'S1';
                jumpType = calculateJumpType(prevStage, stage);
            }
            
            return {
                sequence: idx,
                timestamp: msg.timestamp,
                role: msg.role,
                content: msg.content.substring(0, 100),
                stage,
                topic,
                act,
                topicName: TOPIC_NAMES[topic] || topic,
                stageName: STAGE_NAMES[stage] || stage,
                jumpType
            };
        });
        
        // 判断转化
        const isConverted = (row.reason_type_name || '').includes('意向') || 
                            (row.call_type || '').includes('成功');
        
        staResults.push({
            call_id: row.call_id,
            clue_id: row.clue_id,
            segments: segments,
            conversionAnalysis: { isConverted }
        });
        
        if (i % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            onProgress(i + 1, rows.length);
        }
    }
    
    onProgress(rows.length, rows.length);
    
    // 构建图谱
    console.log('构建图谱，共', staResults.length, '通电话，总segments:', 
        staResults.reduce((sum, c) => sum + c.segments.length, 0));
    
    const builder = new Neo4jGraphBuilder();
    AppState.graphData = builder.buildFromSTAResults(staResults);
    AppState.staResults = staResults;
    
    console.log('图谱构建完成:', 
        AppState.graphData.nodes.length, '节点,', 
        AppState.graphData.edges.length, '边');
    
    // 存储
    try {
        localStorage.setItem('zhiji_sta_v5', JSON.stringify({
            graphData: AppState.graphData,
            totalCount: staResults.length,
            timestamp: Date.now()
        }));
        showNotification(`成功导入 ${staResults.length} 通电话`, 'success');
    } catch (e) {
        console.error('存储失败:', e);
    }
    
    displaySTAResults();
}

/**
 * 解析ASR文本 - 提取时间戳、角色、内容
 * 格式: "13:58:15 销售:是没有选装的。你好。"
 */
function parseASRAdvanced(asrText) {
    const text = asrText.replace(/^"|"$/g, '');
    const messages = [];
    
    // 匹配模式: 时间 角色:内容
    // 支持: "13:58:15 销售:内容" 或 "13:58:15销售:内容"
    const pattern = /(\d{1,2}:\d{2}:\d{2})\s*([销售客户][^:：]*)[：:]\s*([^\d]{0,500})/g;
    
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const timestamp = match[1];
        const roleText = match[2].trim();
        const content = match[3].trim();
        
        const role = roleText.includes('销售') ? 'sales' : 'customer';
        
        if (content.length >= 2) {
            messages.push({ timestamp, role, content });
        }
    }
    
    // 如果没有匹配到，整段作为一条消息
    if (messages.length === 0 && text.length > 5) {
        const role = text.includes('销售') || text.includes('您好') ? 'sales' : 'customer';
        messages.push({ timestamp: '', role, content: text });
    }
    
    return { messages };
}

// ============================================
// Stage/Topic/Act 识别
// ============================================
function detectStage(content, idx) {
    const keywords = {
        'S1': ['您好', '我是', '智己', '看到您', '关注到', '留资', '你好'],
        'S2': ['关注哪款', '看的是', '预算', '用途', '试驾', '需求', '车型'],
        'S3': ['配置', '续航', '价格', '优惠', '补贴', '性能', '空间'],
        'S4': ['贵', '考虑', '担心', '顾虑', '比较', '犹豫', '便宜'],
        'S5': ['微信', '加您', '约', '时间', '确认', '周六', '周日']
    };
    
    // 开场优先S1
    if (idx <= 1) {
        for (const word of keywords['S1']) {
            if (content.includes(word)) return 'S1';
        }
    }
    
    let bestStage = 'S2';
    let maxScore = 0;
    
    for (const [stage, words] of Object.entries(keywords)) {
        const score = words.filter(w => content.includes(w)).length;
        if (score > maxScore) {
            maxScore = score;
            bestStage = stage;
        }
    }
    
    return bestStage;
}

function detectTopic(content, stage) {
    const keywords = {
        'T1-1': ['您好', '我是', '智己', '你好'],
        'T1-2': ['留资', '关注到', '看到您'],
        'T2-1': ['车型', '关注哪款', '看的是'],
        'T2-2': ['试驾', '体验'],
        'T3-1': ['续航', '配置', '空间'],
        'T3-2': ['价格', '优惠', '补贴', '多少钱'],
        'T4-1': ['贵', '便宜', '降价'],
        'T5-1': ['微信', '加您', '联系']
    };
    
    for (const [topic, words] of Object.entries(keywords)) {
        if (words.some(w => content.includes(w))) return topic;
    }
    
    const defaults = { 'S1': 'T1-1', 'S2': 'T2-1', 'S3': 'T3-1', 'S4': 'T4-1', 'S5': 'T5-1' };
    return defaults[stage] || 'T1-1';
}

function detectAct(content, role) {
    if (role !== 'sales') return 'A1';
    
    if (content.includes('解释') || content.includes('介绍')) return 'A1';
    if (content.includes('确认') || content.includes('对吗')) return 'A2';
    if (content.includes('优惠') || content.includes('补贴')) return 'A3';
    if (content.includes('时间') || content.includes('周六')) return 'A4';
    if (content.includes('月底') || content.includes('截止')) return 'A5';
    
    return 'A1';
}

function calculateJumpType(fromStage, toStage) {
    const stageOrder = { 'S1': 1, 'S2': 2, 'S3': 3, 'S4': 4, 'S5': 5 };
    const from = stageOrder[fromStage] || 1;
    const to = stageOrder[toStage] || 1;
    
    if (to > from) return 'C'; // 向下推进
    if (to < from) return 'D'; // 逆向跳转
    return 'B'; // 同层切换
}

// ============================================
// S-T-A结果展示（增强版）
// ============================================
function displaySTAResults() {
    const container = document.getElementById('sta-results-container');
    if (!container) return;
    
    // 统计总segments数
    const totalSegments = AppState.staResults.reduce((sum, c) => sum + c.segments.length, 0);
    
    // 取前3通电话展示完整对话流
    const sampleCalls = AppState.staResults.slice(0, 3);
    
    container.innerHTML = `
        <h3>S-T-A分析结果（共 ${AppState.staResults.length} 通电话，${totalSegments} 条片段）</h3>
        <div class="calls-list">
            ${sampleCalls.map((call, callIdx) => `
                <div class="call-card" style="margin-bottom:20px;border:1px solid #e0e0e0;border-radius:8px;padding:16px;background:#fff;">
                    <div class="call-header" style="font-weight:bold;margin-bottom:12px;display:flex;justify-content:space-between;">
                        <span>通话 ${callIdx + 1}: ${call.call_id?.substring(0, 16)}...</span>
                        <span style="color:${call.conversionAnalysis?.isConverted ? '#4CAF50' : '#999'};">
                            ${call.conversionAnalysis?.isConverted ? '✓ 已转化' : '○ 未转化'}
                        </span>
                    </div>
                    <div class="segments-flow" style="display:flex;flex-direction:column;gap:8px;">
                        ${call.segments.map((seg, idx) => `
                            <div class="segment" style="display:flex;align-items:center;gap:12px;padding:10px;background:${seg.role === 'sales' ? '#E3F2FD' : '#FFF3E0'};border-radius:4px;border-left:4px solid ${STAGE_DEF[seg.stage]?.color};">
                                <span style="font-size:12px;color:#666;min-width:60px;">${seg.timestamp || '--:--:--'}</span>
                                <span class="stage-badge" style="background:${STAGE_DEF[seg.stage]?.color};color:white;padding:2px 8px;border-radius:4px;font-size:12px;min-width:40px;text-align:center;">${seg.stage}</span>
                                <span style="font-weight:500;min-width:80px;">${seg.topic}</span>
                                <span style="font-size:12px;color:#666;min-width:50px;">${seg.act}</span>
                                <span style="flex:1;font-size:13px;color:#333;">${seg.content.substring(0, 60)}${seg.content.length > 60 ? '...' : ''}</span>
                                ${idx > 0 ? `<span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${seg.jumpType === 'D' ? '#FF9800' : '#4CAF50'};color:white;">${seg.jumpType}</span>` : '<span style="font-size:11px;color:#999;">开始</span>'}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
        <p style="color:#999;margin-top:10px;">展示前3通电话，共 ${AppState.staResults.length} 通</p>
    `;
}

// ============================================
// 图谱渲染V5 - 分层布局（修复版）
// ============================================
function renderGraphV5() {
    const container = document.getElementById('graph-container');
    if (!container || !AppState.graphData) {
        container.innerHTML = '<div style="text-align:center;padding:50px;color:#999;">请先上传CSV数据</div>';
        return;
    }
    
    const { nodes, edges } = AppState.graphData;
    
    if (!nodes || nodes.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:50px;color:#999;">暂无节点数据</div>';
        return;
    }
    
    console.log('渲染图谱:', nodes.length, '节点,', edges?.length || 0, '边');
    
    container.innerHTML = '';
    
    const width = container.clientWidth || 1000;
    const height = 700;
    
    const svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', '#fafafa');
    
    // 箭头定义
    const defs = svg.append('defs');
    ['forward', 'backward'].forEach(type => {
        defs.append('marker')
            .attr('id', `arrow-${type}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 28)
            .attr('refY', 0)
            .attr('markerWidth', 8)
            .attr('markerHeight', 8)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', type === 'backward' ? '#FF9800' : '#4CAF50');
    });
    
    const g = svg.append('g');
    
    // 缩放
    svg.call(d3.zoom()
        .extent([[0, 0], [width, height]])
        .scaleExtent([0.3, 3])
        .on('zoom', (e) => g.attr('transform', e.transform)));
    
    // 分层布局 - 按Stage预设Y坐标
    const stageY = {
        'S1': height * 0.15,
        'S2': height * 0.35,
        'S3': height * 0.55,
        'S4': height * 0.75,
        'S5': height * 0.9
    };
    
    // 为节点设置初始位置
    nodes.forEach(n => {
        n.y = stageY[n.stage] || (height / 2);
        n.fx = null; // 允许X自由移动
        n.fy = n.y;  // 固定Y在对应层级
    });
    
    // 准备边数据
    const links = (edges || []).map(e => ({
        ...e,
        source: typeof e.source === 'object' ? e.source.id : e.source,
        target: typeof e.target === 'object' ? e.target.id : e.target
    }));
    
    // 力导向模拟
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-400))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.radius || 20) + 15))
        .force('y', d3.forceY(d => stageY[d.stage] || height/2).strength(0.8));
    
    // 绘制边
    const link = g.append('g')
        .selectAll('path')
        .data(links)
        .join('path')
        .attr('stroke', d => d.jumpType === 'D' ? '#FF9800' : '#4CAF50')
        .attr('stroke-width', d => Math.max(2, Math.min((d.probability || 0.3) * 10, 8)))
        .attr('stroke-opacity', 0.7)
        .attr('fill', 'none')
        .attr('marker-end', d => `url(#arrow-${d.jumpType === 'D' ? 'backward' : 'forward'})`);
    
    // 节点组
    const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .call(d3.drag()
            .on('start', (e, d) => {
                if (!e.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
            })
            .on('drag', (e, d) => { d.fx = e.x; })
            .on('end', (e, d) => {
                if (!e.active) simulation.alphaTarget(0);
                d.fx = null;
            }));
    
    // 节点圆圈
    node.append('circle')
        .attr('r', d => Math.max(12, Math.min((d.frequency || 10) / 5 + 12, 35)))
        .attr('fill', d => STAGE_DEF[d.stage]?.color || '#999')
        .attr('stroke', '#fff')
        .attr('stroke-width', 3)
        .style('cursor', 'pointer');
    
    // 节点标签（Topic名）
    node.append('text')
        .attr('dy', d => Math.max(12, Math.min((d.frequency || 10) / 5 + 12, 35)) + 18)
        .attr('text-anchor', 'middle')
        .text(d => d.name)
        .attr('font-size', '12px')
        .attr('fill', '#333')
        .attr('font-weight', '500');
    
    // Stage标签
    node.append('text')
        .attr('dy', 4)
        .attr('text-anchor', 'middle')
        .text(d => d.stage)
        .attr('font-size', '11px')
        .attr('fill', '#fff')
        .attr('font-weight', 'bold');
    
    // 概率标签（主要边）
    g.append('g')
        .selectAll('text')
        .data(links.filter(e => e.probability > 0.2))
        .join('text')
        .attr('font-size', '10px')
        .attr('fill', '#666')
        .text(d => `${Math.round((d.probability || 0) * 100)}%`);
    
    // 更新位置
    simulation.on('tick', () => {
        link.attr('d', d => {
            // 直线路径
            return `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`;
        });
        
        node.attr('transform', d => `translate(${d.x},${d.y})`);
        
        // 更新概率标签位置
        g.selectAll('text')
            .filter(function() { return this.textContent.includes('%'); })
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2 - 5);
    });
    
    // 添加Stage层级标签
    const stageLabels = g.append('g').attr('class', 'stage-labels');
    Object.entries(STAGE_DEF).forEach(([stage, info]) => {
        stageLabels.append('text')
            .attr('x', 30)
            .attr('y', stageY[stage] - 40)
            .text(info.name)
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .attr('fill', info.color);
    });
}

// ============================================
// 实时引导
// ============================================
function initGuidePage() {}

function generateRecommendation() {
    const intent = document.getElementById('customer-intent')?.value?.trim();
    if (!intent) {
        showNotification('请输入客户意图', 'error');
        return;
    }
    if (!AppState.graphData) {
        showNotification('请先上传CSV数据', 'error');
        return;
    }
    
    const engine = new RecommendationEngine(AppState.graphData);
    const options = engine.generateOptions(AppState.currentTopicId, intent);
    renderOptions(options);
}

function renderOptions(options) {
    const container = document.getElementById('recommendation-result');
    if (!container) return;
    
    container.innerHTML = `
        <h3>推荐策略：</h3>
        <div class="options-grid">
            ${options.map((opt, idx) => `
                <div class="option-card" onclick="selectOption(${idx})" style="padding:16px;border:1px solid #e0e0e0;border-radius:8px;margin-bottom:12px;cursor:pointer;background:#fff;">
                    <div style="font-weight:bold;color:#1976D2;">${opt.rank}. ${opt.actName}</div>
                    <div style="margin:8px 0;color:#333;">${opt.scriptTemplate}</div>
                    <div style="font-size:12px;color:#666;">转化率: ${opt.successRate} | 使用: ${opt.usageCount}次</div>
                </div>
            `).join('')}
        </div>
    `;
    
    AppState.currentOptions = options;
}

function selectOption(index) {
    const option = AppState.currentOptions?.[index];
    if (!option) return;
    
    AppState.conversationHistory.push({
        sales: option.scriptTemplate,
        customer: option.predictedReply,
        topic: option.toTopicId
    });
    
    AppState.currentTopicId = option.toTopicId;
    
    document.getElementById('customer-intent').value = '';
    showNotification('已选择策略', 'success');
}

// ============================================
// 仪表盘
// ============================================
function updateDashboardStats() {
    const totalEl = document.getElementById('stat-total-cases');
    const rateEl = document.getElementById('stat-conversion-rate');
    const pathEl = document.getElementById('stat-path-count');
    
    if (totalEl) totalEl.textContent = AppState.staResults.length;
    
    if (rateEl) {
        const converted = AppState.staResults.filter(r => r.conversionAnalysis?.isConverted).length;
        const rate = AppState.staResults.length > 0 ? (converted / AppState.staResults.length * 100).toFixed(0) : 0;
        rateEl.textContent = rate + '%';
    }
    
    if (pathEl) pathEl.textContent = AppState.graphData?.nodes?.length || 0;
}

// ============================================
// UI工具
// ============================================
function showLoading(text) {
    const mask = document.getElementById('loading-mask');
    const textEl = document.getElementById('loading-text');
    if (mask) mask.style.display = 'flex';
    if (textEl) textEl.textContent = text;
}

function updateLoadingText(text) {
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.textContent = text;
}

function hideLoading() {
    const mask = document.getElementById('loading-mask');
    if (mask) mask.style.display = 'none';
}

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#F44336' : '#2196F3'};
        color: white;
        border-radius: 4px;
        z-index: 10000;
    `;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// ============================================
// 导出全局函数
// ============================================
window.login = login;
window.navigateTo = navigateTo;
window.handleFileUpload = handleFileUpload;
window.generateRecommendation = generateRecommendation;
window.selectOption = selectOption;
