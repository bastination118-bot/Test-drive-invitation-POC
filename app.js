/**
 * 智己汽车 - 试驾邀约POC (V5.2-Fix)
 * 纯前端实现，GitHub Pages部署
 * 
 * 关键修复:
 * 1. GBK编码自动检测与解码
 * 2. 按call_id分组，正确构建多轮对话transition
 */

// ============================================
// 全局状态（带localStorage持久化）
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

// Stage定义
const STAGE_DEF = {
    S1: { name: '开场破冰', color: '#1E88E5' },
    S2: { name: '需求挖掘', color: '#00ACC1' },
    S3: { name: '产品价值传递', color: '#4CAF50' },
    S4: { name: '异议处理', color: '#FFC107' },
    S5: { name: '邀约收口', color: '#9C27B0' }
};

// ============================================
// 编码检测与解码（使用原生TextDecoder）
// ============================================
function detectAndDecode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    
    // 采样前1000字节检测编码
    let highBytes = 0;
    const sampleSize = Math.min(bytes.length, 1000);
    
    for (let i = 0; i < sampleSize; i++) {
        if (bytes[i] > 0x80) {
            highBytes++;
        }
    }
    
    // 如果高字节比例>5%，可能是GBK
    const isGBK = highBytes > (sampleSize * 0.05);
    
    if (isGBK) {
        try {
            // 尝试使用原生TextDecoder解码GBK
            const decoder = new TextDecoder('gbk', { fatal: true });
            const text = decoder.decode(arrayBuffer);
            console.log('使用原生TextDecoder解码GBK成功');
            return text;
        } catch (e) {
            console.warn('GBK解码失败，回退到UTF-8:', e);
        }
    }
    
    // 默认UTF-8
    return new TextDecoder('utf-8').decode(arrayBuffer);
}

// ============================================
// 错误边界
// ============================================
window.onerror = function(msg, url, line) {
    console.error('页面错误:', msg, 'at', url, ':', line);
    return false;
};

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof d3 === 'undefined') {
        document.body.innerHTML = '<div style="padding:50px;text-align:center;">D3.js加载失败，请检查网络连接<br>建议使用Chrome浏览器，或刷新页面重试</div>';
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
            console.log('从localStorage恢复图谱:', AppState.graphData?.nodes?.length || 0, '节点');
        }
    } catch (e) {
        console.error('恢复数据失败', e);
    }
    
    updateDashboardStats();
}

// ============================================
// 登录
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

// ============================================
// 导航
// ============================================
function navigateTo(page) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${page}"]`)?.classList.add('active');
    
    document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    
    AppState.currentPage = page;
    
    if (page === 'graph') {
        if (AppState.graphData) {
            setTimeout(renderGraph, 50);
        } else {
            const container = document.getElementById('graph-container');
            if (container) {
                container.innerHTML = '<div style="text-align:center;padding:50px;color:#999;">请先上传CSV数据生成图谱</div>';
            }
        }
    } else if (page === 'guide') {
        initGuidePage();
    } else if (page === 'dashboard') {
        updateDashboardStats();
    }
}

// ============================================
// 文件上传与S-T-A分析（V5.2修复版）
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
                // 使用ArrayBuffer读取，支持编码检测
                const arrayBuffer = e.target.result;
                const text = detectAndDecode(arrayBuffer);
                rows = parseCSV(text);
                console.log('CSV解析完成，共', rows.length, '行');
            } else if (file.name.endsWith('.xlsx')) {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(sheet);
            }
            
            // 按call_id分组构建完整通话记录
            const callGroups = groupByCallId(rows);
            console.log('通话分组完成，共', Object.keys(callGroups).length, '通电话');
            
            await processCalls(callGroups, (progress, total) => {
                updateLoadingText(`正在分析S-T-A: ${progress}/${total}`);
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
        // CSV使用ArrayBuffer读取以便编码检测
        reader.readAsArrayBuffer(file);
    }
}

/**
 * 按call_id分组（关键修复）
 */
function groupByCallId(rows) {
    const groups = {};
    
    rows.forEach(row => {
        const callId = row.call_id || row.id || 'unknown';
        if (!groups[callId]) {
            groups[callId] = [];
        }
        groups[callId].push(row);
    });
    
    return groups;
}

/**
 * 处理分组后的通话记录
 */
async function processCalls(callGroups, onProgress) {
    const callIds = Object.keys(callGroups);
    const allResults = [];
    
    for (let i = 0; i < callIds.length; i++) {
        const callId = callIds[i];
        const rows = callGroups[callId];
        
        // 分析单个通话
        const callResult = analyzeCall(callId, rows);
        
        // 只保存有多个segments的通话（用于生成路径）
        if (callResult.segments.length >= 1) {
            allResults.push(callResult);
        }
        
        if (i % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            onProgress(i + 1, callIds.length);
        }
    }
    
    onProgress(callIds.length, callIds.length);
    
    // 构建图谱
    console.log('构建图谱，共', allResults.length, '通电话，总segments:', 
        allResults.reduce((sum, c) => sum + c.segments.length, 0));
    
    const builder = new Neo4jGraphBuilder();
    AppState.graphData = builder.buildFromSTAResults(allResults);
    AppState.staResults = allResults;
    
    console.log('图谱构建完成:', 
        AppState.graphData.nodes.length, '节点,', 
        AppState.graphData.edges.length, '边');
    
    // 存储
    try {
        localStorage.setItem('zhiji_sta_v5', JSON.stringify({
            graphData: AppState.graphData,
            totalCount: allResults.length,
            timestamp: Date.now()
        }));
        showNotification(`成功导入 ${allResults.length} 通电话`, 'success');
    } catch (e) {
        console.error('localStorage存储失败:', e);
        showNotification(`导入成功，但无法本地存储`, 'warning');
    }
    
    displaySTAResults();
}

/**
 * 分析单通电话 - 解析asr字段内的多轮对话
 */
function analyzeCall(callId, rows) {
    // 每行是一个call，取第一行
    const row = rows[0];
    const asrText = row.asr || '';
    
    // 解析asr文本中的多轮对话
    // 格式: "时间 角色:内容 时间 角色:内容..."
    const segments = parseASRText(asrText);
    
    // 判断转化
    const isConverted = (row.reason_type_name || '').includes('意向') || 
                        (row.call_result || '').includes('约') ||
                        (row.call_type || '').includes('成功');
    
    return {
        call_id: callId,
        segments: segments,
        conversionAnalysis: { isConverted }
    };
}

/**
 * 解析ASR文本为segments
 * 格式: "13:58:15 销售:你好 13:58:17 客户:你好..."
 */
function parseASRText(asrText) {
    const segments = [];
    
    // 移除首尾引号
    let text = asrText.replace(/^"|"$/g, '');
    
    // 匹配时间戳+角色+内容的模式
    // 格式: HH:MM:SS 角色:内容
    const pattern = /(\d{1,2}:\d{2}:\d{2})\s*([销售客户]+)\s*:\s*([^\d]{0,200})/g;
    
    let match;
    let lastTimestamp = null;
    let lastRole = null;
    
    while ((match = pattern.exec(text)) !== null) {
        const timestamp = match[1];
        const role = match[2].includes('销售') ? 'sales' : 'customer';
        const content = match[3].trim();
        
        if (content.length < 2) continue; // 跳过太短的
        
        // 识别Stage/Topic/Act
        const stage = detectStage(content, segments.length);
        const topic = detectTopic(content, stage);
        const act = detectAct(content, role);
        
        segments.push({
            stage,
            topic,
            act,
            content: content.substring(0, 100),
            role,
            topicName: TOPIC_NAMES[topic] || topic,
            stageName: STAGE_NAMES[stage] || stage,
            timestamp
        });
        
        lastTimestamp = timestamp;
        lastRole = role;
    }
    
    // 如果正则没有匹配到，尝试简单分割
    if (segments.length === 0) {
        // 按常见分隔符分割
        const parts = text.split(/(?=\d{1,2}:\d{2})/).filter(p => p.trim());
        
        parts.forEach((part, idx) => {
            // 检测角色
            let role = 'customer';
            if (part.includes('销售') || part.includes('顾问') || idx % 2 === 0) {
                role = 'sales';
            }
            
            const content = part.replace(/^[^:]*:/, '').trim() || part.trim();
            if (content.length < 2) return;
            
            const stage = detectStage(content, idx);
            const topic = detectTopic(content, stage);
            const act = detectAct(content, role);
            
            segments.push({
                stage,
                topic,
                act,
                content: content.substring(0, 100),
                role,
                topicName: TOPIC_NAMES[topic] || topic,
                stageName: STAGE_NAMES[stage] || stage
            });
        });
    }
    
    // 如果还是没有，整段作为一个segment
    if (segments.length === 0 && text.length > 5) {
        const stage = detectStage(text, 0);
        const topic = detectTopic(text, stage);
        
        segments.push({
            stage,
            topic,
            act: 'A1',
            content: text.substring(0, 100),
            role: 'sales',
            topicName: TOPIC_NAMES[topic] || topic,
            stageName: STAGE_NAMES[stage] || stage
        });
    }
    
    return segments;
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    
    // 解析表头
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });
        rows.push(row);
    }
    
    return rows;
}

/**
 * 解析CSV单行（处理引号内的逗号）
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // 跳过下一个引号
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

// ============================================
// Stage/Topic/Act 识别
// ============================================
function detectStage(content, idx) {
    // 根据对话位置和内容综合判断
    const keywords = {
        'S1': ['您好', '我是', '智己', '看到您', '关注到', '留资'],
        'S2': ['关注哪款', '看的是', '预算', '用途', '试驾', '需求'],
        'S3': ['配置', '续航', '价格', '优惠', '补贴', '性能'],
        'S4': ['贵', '考虑', '担心', '顾虑', '比较', '犹豫'],
        'S5': ['微信', '加您', '约', '时间', '确认', '周六', '周日']
    };
    
    // 如果是开场，优先S1
    if (idx <= 2) {
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
        'T1-1': ['您好', '我是', '智己'],
        'T1-2': ['留资', '关注到', '看到您'],
        'T2-1': ['车型', '关注哪款', '看的是'],
        'T2-2': ['试驾', '体验'],
        'T3-1': ['续航', '配置', '空间'],
        'T3-2': ['价格', '优惠', '补贴', '多少钱'],
        'T4-1': ['贵', '便宜', '降价'],
        'T5-1': ['微信', '加您', '联系'],
        'T5-2': ['时间', '周六', '周日', '约']
    };
    
    for (const [topic, words] of Object.entries(keywords)) {
        if (words.some(w => content.includes(w))) {
            return topic;
        }
    }
    
    // 默认根据stage返回
    const defaults = {
        'S1': 'T1-1', 'S2': 'T2-1', 'S3': 'T3-1', 'S4': 'T4-1', 'S5': 'T5-1'
    };
    return defaults[stage] || 'T1-1';
}

function detectAct(content, role) {
    if (role !== 'sales') return 'A1';
    
    if (content.includes('解释') || content.includes('介绍') || content.includes('因为')) return 'A1';
    if (content.includes('确认') || content.includes('对吗') || content.includes('是吧')) return 'A2';
    if (content.includes('优惠') || content.includes('补贴') || content.includes('送')) return 'A3';
    if (content.includes('时间') || content.includes('周六') || content.includes('周日')) return 'A4';
    if (content.includes('月底') || content.includes('截止') || content.includes('活动')) return 'A5';
    
    return 'A1';
}

// ============================================
// S-T-A结果展示
// ============================================
function displaySTAResults() {
    const container = document.getElementById('sta-results-container');
    if (!container) return;
    
    // 取第一通电话展示
    const firstCall = AppState.staResults[0];
    if (!firstCall) {
        container.innerHTML = '<p>暂无分析结果</p>';
        return;
    }
    
    container.innerHTML = `
        <h3>S-T-A分析结果示例（通话ID: ${firstCall.call_id}）</h3>
        <div class="sta-list">
            <div class="sta-item">
                <div class="sta-header">
                    <span class="sta-conversion ${firstCall.conversionAnalysis?.isConverted ? 'converted' : ''}">
                        ${firstCall.conversionAnalysis?.isConverted ? '✓ 转化成功' : '○ 未转化'}
                    </span>
                </div>
                <div class="sta-segments">
                    ${firstCall.segments.map((s, idx) => `
                        <div class="sta-seg">
                            <span class="seg-idx">${idx + 1}</span>
                            <span class="stage-badge" style="background:${STAGE_DEF[s.stage]?.color}">${s.stage}</span>
                            <span class="topic-badge">${s.topic}</span>
                            <span class="act-badge">${s.act}</span>
                            <span class="content">${s.content}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <p style="color:#999;margin-top:10px;">共分析 ${AppState.staResults.length} 通电话</p>
    `;
}

// ============================================
// 图谱渲染
// ============================================
function renderGraph() {
    const container = document.getElementById('graph-container');
    if (!container || !AppState.graphData) {
        container.innerHTML = '<div style="text-align:center;padding:50px;color:#999;">请先上传CSV数据</div>';
        return;
    }
    
    const data = AppState.graphData;
    
    if (!data.nodes || data.nodes.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:50px;color:#999;">暂无节点数据</div>';
        return;
    }
    
    console.log('渲染图谱:', data.nodes.length, '节点,', data.edges?.length || 0, '边');
    
    container.innerHTML = '';
    
    const width = container.clientWidth || 800;
    const height = 600;
    
    const svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', [0, 0, width, height])
        .style('background', '#f5f5f5');
    
    const g = svg.append('g');
    
    svg.call(d3.zoom()
        .extent([[0, 0], [width, height]])
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        }));
    
    // 准备边数据
    const links = (data.edges || []).map(e => ({
        ...e,
        source: typeof e.source === 'object' ? e.source.id : e.source,
        target: typeof e.target === 'object' ? e.target.id : e.target
    }));
    
    console.log('D3 links:', links.length);
    
    const simulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(150))
        .force('charge', d3.forceManyBody().strength(-600))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.radius || 20) + 15));
    
    // 绘制箭头标记
    svg.append('defs').selectAll('marker')
        .data(['end'])
        .enter().append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#999');
    
    // 绘制边
    const link = g.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', d => {
            const rate = d.conversionRate || 0;
            if (rate >= 0.6) return '#4CAF50';
            if (rate >= 0.4) return '#FFC107';
            return '#F44336';
        })
        .attr('stroke-width', d => Math.max(2, (d.probability || 0.3) * 8))
        .attr('stroke-opacity', 0.7)
        .attr('marker-end', 'url(#arrow)');
    
    // 绘制节点
    const node = g.append('g')
        .selectAll('g')
        .data(data.nodes)
        .join('g')
        .call(d3.drag()
            .on('start', (e, d) => {
                if (!e.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on('end', (e, d) => {
                if (!e.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            }));
    
    node.append('circle')
        .attr('r', d => d.radius || 20)
        .attr('fill', d => STAGE_DEF[d.stage]?.color || '#999')
        .attr('stroke', '#fff')
        .attr('stroke-width', 3);
    
    node.append('text')
        .attr('dy', d => (d.radius || 20) + 15)
        .attr('text-anchor', 'middle')
        .text(d => d.name)
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', '500');
    
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        node.attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

// ============================================
// 实时引导 - 3选1推荐
// ============================================
function initGuidePage() {
    // 已在HTML中定义
}

function generateRecommendation() {
    const intent = document.getElementById('customer-intent')?.value?.trim();
    
    if (!intent) {
        showNotification('请输入客户意图', 'error');
        return;
    }
    
    if (!AppState.graphData) {
        showNotification('请先上传CSV案例数据', 'error');
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
                <div class="option-card ${opt.riskLevel}" onclick="selectOption(${idx})">
                    <div class="opt-rank">${opt.rank}</div>
                    <div class="opt-act">${opt.actName}</div>
                    <div class="opt-script">${opt.scriptTemplate}</div>
                    <div class="opt-stats">转化率: ${opt.successRate} | 使用: ${opt.usageCount}次</div>
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
    renderConversationFlow();
    
    document.getElementById('customer-intent').value = '';
}

function renderConversationFlow() {
    const container = document.getElementById('conversation-flow');
    if (!container) return;
    
    container.innerHTML = `
        <h3>对话历史</h3>
        ${AppState.conversationHistory.map(turn => `
            <div class="turn">
                <div class="sales-bubble"><strong>销售：</strong>${turn.sales}</div>
                <div class="customer-bubble"><strong>客户：</strong>${turn.customer}</div>
            </div>
        `).join('')}
    `;
    container.scrollTop = container.scrollHeight;
}

// ============================================
// 仪表盘统计
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
// UI工具函数
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
    notif.className = `notification ${type}`;
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
