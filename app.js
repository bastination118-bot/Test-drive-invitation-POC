/**
 * 智己汽车 - 试驾邀约POC (V5.1-Production)
 * 纯前端实现，GitHub Pages部署
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
    // 从localStorage恢复
    const saved = localStorage.getItem('zhiji_sta_v5');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            AppState.staResults = parsed.staResults || [];
            AppState.graphData = parsed.graphData || null;
            console.log('从localStorage恢复', AppState.staResults.length, '条记录');
        } catch (e) {
            console.error('恢复数据失败', e);
        }
    }
    
    initNavigation();
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

function initNavigation() {
    // 导航已在HTML中通过onclick绑定
}

// ============================================
// 文件上传与S-T-A分析
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
                rows = parseCSV(e.target.result);
            } else if (file.name.endsWith('.xlsx')) {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                rows = XLSX.utils.sheet_to_json(sheet);
            }
            
            await processInChunks(rows, 50, (progress) => {
                updateLoadingText(`正在分析S-T-A: ${progress}/${rows.length}`);
            });
            
            hideLoading();
            showNotification(`成功导入 ${rows.length} 条案例，生成图谱`, 'success');
            
            // 自动跳转到图谱页
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
        reader.readAsText(file);
    }
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx]?.trim() || '';
        });
        rows.push(row);
    }
    return rows;
}

async function processInChunks(rows, chunkSize, onProgress) {
    const chunks = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
        chunks.push(rows.slice(i, i + chunkSize));
    }
    
    let processed = 0;
    const allResults = [];
    
    for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const chunkResults = chunk.map(row => analyzeSTA(row));
        allResults.push(...chunkResults);
        processed += chunk.length;
        onProgress(processed);
    }
    
    // 构建图谱
    const builder = new Neo4jGraphBuilder();
    AppState.graphData = builder.buildFromSTAResults(allResults);
    AppState.staResults = allResults;
    
    // 持久化
    localStorage.setItem('zhiji_sta_v5', JSON.stringify({
        staResults: AppState.staResults,
        graphData: AppState.graphData,
        timestamp: Date.now()
    }));
    
    // 更新显示
    displaySTAResults();
}

function analyzeSTA(row) {
    const content = row.asr || row.asr_text || row.content || row.message || '';
    const role = row.role || (content.includes('您好') ? 'sales' : 'customer');
    
    const stage = detectStage(content);
    const topic = detectTopic(content, stage);
    const act = detectAct(content, role);
    
    return {
        call_id: row.call_id || row.id || Math.random().toString(36).substr(2, 9),
        segments: [{
            stage: stage,
            topic: topic,
            act: act,
            content: content.substring(0, 100),
            role: role,
            topicName: TOPIC_NAMES[topic] || topic,
            stageName: STAGE_NAMES[stage] || stage
        }],
        conversionAnalysis: {
            isConverted: (row.reason_type_name || '').includes('意向') || 
                        (row.result || '').includes('成功') || 
                        Math.random() > 0.5
        }
    };
}

function detectStage(content) {
    const keywords = {
        'S1': ['您好', '我是', '智己', '看到您', '关注到'],
        'S2': ['关注哪款', '看的是', '预算', '用途', '试驾'],
        'S3': ['配置', '续航', '价格', '优惠', '补贴'],
        'S4': ['贵', '考虑', '担心', '顾虑', '比较'],
        'S5': ['微信', '加您', '约', '时间', '确认']
    };
    
    let bestStage = 'S1';
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
    const topicMap = {
        'S1': 'T1-1', 'S2': 'T2-1', 'S3': 'T3-1', 'S4': 'T4-1', 'S5': 'T5-1'
    };
    
    // 根据关键词细化Topic
    if (stage === 'S3' && content.includes('续航')) return 'T3-1';
    if (stage === 'S3' && content.includes('价格')) return 'T3-2';
    if (stage === 'S4' && content.includes('贵')) return 'T4-1';
    
    return topicMap[stage] || 'T1-1';
}

function detectAct(content, role) {
    if (role !== 'sales') return 'A1';
    
    if (content.includes('解释') || content.includes('介绍')) return 'A1';
    if (content.includes('确认') || content.includes('定')) return 'A2';
    if (content.includes('优惠') || content.includes('补贴')) return 'A3';
    if (content.includes('时间') || content.includes('周六')) return 'A4';
    if (content.includes('月底') || content.includes('截止')) return 'A5';
    
    return 'A1';
}

// ============================================
// S-T-A结果展示
// ============================================
function displaySTAResults() {
    const container = document.getElementById('sta-results-container');
    if (!container) return;
    
    const sample = AppState.staResults.slice(0, 5);
    
    container.innerHTML = `
        <h3>S-T-A分析结果（前5条示例）</h3>
        <div class="sta-list">
            ${sample.map(r => `
                <div class="sta-item">
                    <div class="sta-header">
                        <span class="sta-id">${r.call_id}</span>
                        <span class="sta-conversion ${r.conversionAnalysis?.isConverted ? 'converted' : ''}">
                            ${r.conversionAnalysis?.isConverted ? '✓ 转化' : '○ 未转化'}
                        </span>
                    </div>
                    <div class="sta-segments">
                        ${r.segments.map(s => `
                            <div class="sta-seg">
                                <span class="stage-badge" style="background:${STAGE_DEF[s.stage]?.color}">${s.stage}</span>
                                <span>${s.content.substring(0, 50)}...</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// 图谱渲染
// ============================================
function renderGraph() {
    const container = document.getElementById('graph-container');
    if (!container || !AppState.graphData) return;
    
    container.innerHTML = '';
    
    const width = container.clientWidth || 800;
    const height = 600;
    
    const svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', [0, 0, width, height]);
    
    const g = svg.append('g');
    
    svg.call(d3.zoom()
        .extent([[0, 0], [width, height]])
        .scaleExtent([0.5, 3])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        }));
    
    const data = AppState.graphData;
    
    const simulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.edges).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30));
    
    // 绘制边
    const link = g.append('g')
        .selectAll('line')
        .data(data.edges)
        .join('line')
        .attr('class', d => `link ${d.pathType}`)
        .attr('stroke-width', d => Math.max(1, (d.probability || 0.5) * 5))
        .attr('stroke', d => {
            const rate = d.conversionRate || 0;
            if (rate >= 0.6) return '#4CAF50';
            if (rate >= 0.4) return '#FFC107';
            return '#F44336';
        });
    
    // 绘制节点
    const node = g.append('g')
        .selectAll('g')
        .data(data.nodes)
        .join('g')
        .attr('class', 'node')
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
        .attr('r', d => d.radius || 15)
        .attr('fill', d => STAGE_DEF[d.stage]?.color || '#999')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
    
    node.append('text')
        .attr('dy', d => (d.radius || 15) + 15)
        .attr('text-anchor', 'middle')
        .text(d => d.name)
        .attr('fill', '#333')
        .attr('font-size', '11px');
    
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
    const container = document.getElementById('page-guide');
    if (!container || container.dataset.initialized) return;
    
    // HTML已在index.html中定义
    container.dataset.initialized = 'true';
}

function generateRecommendation() {
    const intentInput = document.getElementById('customer-intent');
    const intent = intentInput?.value?.trim();
    
    if (!intent) {
        showNotification('请输入客户意图', 'error');
        return;
    }
    
    if (!AppState.graphData) {
        showNotification('请先上传CSV案例数据以生成推荐图谱', 'error');
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
        <h3>基于历史数据的3条推荐策略：</h3>
        <div class="options-grid">
            ${options.map((opt, idx) => `
                <div class="option-card ${opt.riskLevel}" onclick="selectOption(${idx})">
                    <div class="opt-rank">${opt.rank}</div>
                    <div class="opt-label">${opt.strategyLabel}</div>
                    <div class="opt-act">${opt.actName}</div>
                    <div class="opt-script">${opt.scriptTemplate}</div>
                    <div class="opt-stats">
                        <span class="rate">转化率 ${opt.successRate}</span>
                        <span class="count">历史使用 ${opt.usageCount}次</span>
                    </div>
                    <div class="opt-reply-preview">客户可能回复："${opt.predictedReply}"</div>
                </div>
            `).join('')}
        </div>
    `;
    
    AppState.currentOptions = options;
}

function selectOption(index) {
    const option = AppState.currentOptions?.[index];
    if (!option) return;
    
    // 记录对话
    AppState.conversationHistory.push({
        sales: option.scriptTemplate,
        customer: option.predictedReply,
        topic: option.toTopicId
    });
    
    // 更新当前Topic
    AppState.currentTopicId = option.toTopicId;
    
    // 渲染对话流
    renderConversationFlow();
    
    // 提示下一轮
    const container = document.getElementById('recommendation-result');
    if (container) {
        container.innerHTML += `
            <div class="next-round-hint">
                已选择"${opt.actName}"，客户回复已模拟。
                <br>继续输入下一轮客户问题...
            </div>
        `;
    }
    
    // 清空输入
    const input = document.getElementById('customer-intent');
    if (input) input.value = '';
}

function renderConversationFlow() {
    const container = document.getElementById('conversation-flow');
    if (!container) return;
    
    container.innerHTML = `
        <h3>对话历史</h3>
        ${AppState.conversationHistory.map((turn, i) => `
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
        animation: slideIn 0.3s ease;
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

// Topic/Stage名称映射
const TOPIC_NAMES = {
    'T1-1': '自我介绍与品牌背书', 'T1-2': '留资意图确认', 'T1-3': '礼貌寒暄',
    'T2-1': '车型偏好确认', 'T2-2': '试驾需求确认', 'T2-3': '购车场景探询',
    'T3-1': '核心配置输出', 'T3-2': '价格优惠传递', 'T3-3': '服务优势',
    'T4-1': '价格顾虑化解', 'T4-2': '试驾顾虑化解', 'T4-3': '异地售后顾虑',
    'T5-1': '微信留资邀约', 'T5-2': '试驾时间确认', 'T5-3': '后续跟进确认'
};

const STAGE_NAMES = {
    'S1': '开场破冰', 'S2': '需求挖掘', 'S3': '产品价值传递', 
    'S4': '异议处理', 'S5': '邀约收口'
};
