// ============================================
// 智己汽车 - 试驾邀约会话路径概率图POC
// S-T-A 结构化抽取与语义标注引擎集成版
// ============================================

// 全局状态
const AppState = {
    currentUser: null,
    currentPage: 'dashboard',
    graphData: null,
    cases: [],
    annotations: [],
    staResults: [],  // S-T-A结构化结果
    currentDataSource: null
};

// ============================================
// S-T-A 语义定义
// ============================================

// Stage定义
const STAGE_DEF = {
    S1: { name: '开场破冰', color: '#1E88E5', description: '建立初步联系，获取客户基本信息' },
    S2: { name: '需求挖掘', color: '#00ACC1', description: '深入了解客户需求、预算、时间计划' },
    S3: { name: '产品价值传递', color: '#4CAF50', description: '针对性介绍车型、配置、价格' },
    S4: { name: '异议处理', color: '#FFC107', description: '处理客户顾虑、竞品对比' },
    S5: { name: '邀约收口', color: '#9C27B0', description: '明确试驾时间、地点、准备事项' }
};

// Topic定义 (按Stage分组)
const TOPIC_DEF = {
    // S1 开场破冰
    'T1-1': { stage: 'S1', name: '自我介绍与品牌背书', keywords: ['您好', '我是', '智己', '顾问'] },
    'T1-2': { stage: 'S1', name: '留资意图确认', keywords: ['看到您', '关注', '留资', '在线'] },
    'T1-3': { stage: 'S1', name: '礼貌寒暄与快速切入', keywords: ['你好', '您好', '打扰', '方便'] },
    
    // S2 需求挖掘
    'T2-1': { stage: 'S2', name: '车型偏好确认', keywords: ['关注哪款', '看的是', '喜欢', '考虑'] },
    'T2-2': { stage: 'S2', name: '试驾需求确认', keywords: ['试驾', '体验一下', '试试看'] },
    'T2-3': { stage: 'S2', name: '购车场景与预算探询', keywords: ['预算', '用途', '家里用', '代步'] },
    
    // S3 产品价值传递
    'T3-1': { stage: 'S3', name: '核心配置输出', keywords: ['配置', '续航', '电池', '动力'] },
    'T3-2': { stage: 'S3', name: '价格/优惠政策传递', keywords: ['价格', '优惠', '补贴', '落地价'] },
    'T3-3': { stage: 'S3', name: '服务优势与差异化', keywords: ['服务', '质保', '售后', '保障'] },
    
    // S4 异议处理
    'T4-1': { stage: 'S4', name: '价格顾虑化解', keywords: ['贵', '便宜', '降价', '再考虑'] },
    'T4-2': { stage: 'S4', name: '试驾相关顾虑化解', keywords: ['不用试驾', '没时间', '太远了'] },
    'T4-3': { stage: 'S4', name: '异地/售后顾虑化解', keywords: ['异地', '外地', '上牌', '保养'] },
    
    // S5 邀约收口
    'T5-1': { stage: 'S5', name: '微信留资邀约', keywords: ['微信', '加您', '联系方式', '发给您'] },
    'T5-2': { stage: 'S5', name: '试驾时间确认', keywords: ['约', '时间', '哪天', '周六日'] },
    'T5-3': { stage: 'S5', name: '后续跟进确认', keywords: ['到时候', '再联系', '保持联系', '随时'] }
};

// Act定义 (销售动作)
const ACT_DEF = {
    A1: { name: '专业礼貌问候', keywords: ['您好', '我是', '小王', '顾问'], color: '#2196F3' },
    A2: { name: '赞美认同', keywords: ['眼光', '真好', '不错', '理解', '明白'], color: '#FF9800' },
    A3: { name: '专业解释', keywords: ['续航', '配置', '电池', '采用', '技术'], color: '#4CAF50' },
    A4: { name: '紧迫感营造', keywords: ['月底', '截止', '限量', '活动', '结束'], color: '#F44336' },
    A5: { name: '利益诱导', keywords: ['优惠', '免息', '补贴', '送', '赠'], color: '#9C27B0' },
    A6: { name: '确认引导', keywords: ['方便', '可以', '确认', '到时候', '没问题'], color: '#00BCD4' },
    A7: { name: '顾虑打消', keywords: ['解决', '放心', '没问题', '服务', '保障'], color: '#795548' }
};

// Stage-Topic 树形结构 (用于侧边栏)
const STAGE_TOPIC_DEF = {
    S1: {
        name: '开场破冰',
        color: '#1E88E5',
        topics: {
            'T1-1': { name: '自我介绍与品牌背书' },
            'T1-2': { name: '留资意图确认' },
            'T1-3': { name: '礼貌寒暄与快速切入' }
        }
    },
    S2: {
        name: '需求挖掘',
        color: '#00ACC1',
        topics: {
            'T2-1': { name: '车型偏好确认' },
            'T2-2': { name: '试驾需求确认' },
            'T2-3': { name: '购车场景与预算探询' }
        }
    },
    S3: {
        name: '产品价值传递',
        color: '#4CAF50',
        topics: {
            'T3-1': { name: '核心配置输出' },
            'T3-2': { name: '价格/优惠政策传递' },
            'T3-3': { name: '服务优势与差异化' }
        }
    },
    S4: {
        name: '异议处理',
        color: '#FFC107',
        topics: {
            'T4-1': { name: '价格顾虑化解' },
            'T4-2': { name: '试驾相关顾虑化解' },
            'T4-3': { name: '异地/售后顾虑化解' }
        }
    },
    S5: {
        name: '邀约收口',
        color: '#9C27B0',
        topics: {
            'T5-1': { name: '微信留资邀约' },
            'T5-2': { name: '试驾时间确认' },
            'T5-3': { name: '后续跟进确认' }
        }
    }
};

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    initNavigation();
    initStageTree();
    initGraph();
});

// ============================================
// 登录模块
// ============================================

function login() {
    const account = document.getElementById('login-account').value;
    const password = document.getElementById('login-password').value;
    
    if (account && password) {
        AppState.currentUser = { name: '张销售', account: account };
        document.getElementById('login-page').classList.remove('active');
        document.getElementById('app').classList.add('active');
        showNotification('登录成功', 'success');
    } else {
        showNotification('请输入账号和密码', 'error');
    }
}

// ============================================
// 导航模块
// ============================================

function initNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${page}"]`)?.classList.add('active');
    
    document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    
    AppState.currentPage = page;
    
    if (page === 'graph') {
        renderGraph();
    }
}

// ============================================
// Stage-Topic 树形导航
// ============================================

function initStageTree() {
    const tree = document.querySelector('.stage-tree');
    if (!tree) return;
    
    let html = '';
    for (const [stageCode, stage] of Object.entries(STAGE_TOPIC_DEF)) {
        html += `
            <div class="stage-item" data-stage="${stageCode}">
                <div class="stage-header" onclick="toggleStage('${stageCode}')">
                    <span class="stage-badge ${stageCode.toLowerCase()}">${stageCode}</span>
                    <span class="stage-name">${stage.name}</span>
                    <svg class="toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"/>
                    </svg>
                </div>
                <div class="topic-list" id="topics-${stageCode}" style="display:none;">
                    ${Object.entries(stage.topics).map(([topicCode, topic]) => `
                        <div class="topic-item" data-topic="${topicCode}" onclick="selectTopic('${topicCode}')">
                            ${topic.name}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    tree.innerHTML = html;
}

function toggleStage(stageCode) {
    const list = document.getElementById(`topics-${stageCode}`);
    if (list) {
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
    }
}

function selectTopic(topicCode) {
    console.log('Selected topic:', topicCode);
    // 可以在这里添加Topic筛选图谱的功能
}

// ============================================
// S-T-A 结构化抽取引擎
// ============================================

/**
 * 解析ASR文本，提取时间戳、角色、内容
 */
function parseASRText(asrText) {
    if (!asrText) return [];
    
    const lines = asrText.split('\n');
    const segments = [];
    let sequence = 0;
    
    for (const line of lines) {
        // 匹配格式: "13:58:17 销售:内容" 或 "13:58:17 客户:内容"
        const match = line.match(/(\d{2}:\d{2}:\d{2})\s+(销售|客户)[：:]\s*(.+)/);
        if (match) {
            sequence++;
            segments.push({
                sequence: sequence,
                timestamp: match[1],
                speaker: match[2] === '销售' ? 'sales' : 'customer',
                content: cleanASRText(match[3].trim())
            });
        }
    }
    return segments;
}

/**
 * 清理ASR文本噪声
 */
function cleanASRText(text) {
    return text
        .replace(/(这个|那个|就是|然后|那个)\s*/g, '')  // 删除填充词
        .replace(/嗯+|啊+|呢+|吧+|哦+/g, '')  // 删除语气词
        .replace(/\s+/g, '')  // 删除多余空格
        .trim();
}

/**
 * 识别Stage
 */
function detectStage(content) {
    const stageKeywords = {
        S1: ['您好', '我是', '智己', '看到您', '关注到', '留资', '顾问'],
        S2: ['关注哪款', '看的是', '预算', '用途', '试驾', '偏好', '喜欢'],
        S3: ['配置', '续航', '价格', '优惠', '补贴', '公里', '电池'],
        S4: ['贵', '考虑', '担心', '顾虑', '比较', '再想想', '便宜'],
        S5: ['微信', '加您', '约', '时间', '确认', '到时候', '联系']
    };
    
    let bestStage = 'S1';
    let maxScore = 0;
    
    for (const [stage, keywords] of Object.entries(stageKeywords)) {
        const score = keywords.filter(kw => content.includes(kw)).length;
        if (score > maxScore) {
            maxScore = score;
            bestStage = stage;
        }
    }
    
    return {
        stage: bestStage,
        stageName: STAGE_DEF[bestStage].name,
        confidence: Math.min(0.5 + maxScore * 0.15, 0.95)
    };
}

/**
 * 识别Topic
 */
function detectTopic(content, stage) {
    // 获取该stage下的所有topics
    const stageTopics = Object.entries(TOPIC_DEF)
        .filter(([code, def]) => def.stage === stage);
    
    let bestTopic = stageTopics[0]?.[0] || 'T1-1';
    let maxScore = 0;
    
    for (const [topicCode, topicDef] of stageTopics) {
        const score = topicDef.keywords.filter(kw => content.includes(kw)).length;
        if (score > maxScore) {
            maxScore = score;
            bestTopic = topicCode;
        }
    }
    
    return {
        topic: bestTopic,
        topicName: TOPIC_DEF[bestTopic]?.name || ''
    };
}

/**
 * 识别Act (销售动作)
 */
function detectAct(content, speaker) {
    if (speaker !== 'sales') {
        return { act: null, actName: null };
    }
    
    let bestAct = 'A1';
    let maxScore = 0;
    
    for (const [actCode, actDef] of Object.entries(ACT_DEF)) {
        const score = actDef.keywords.filter(kw => content.includes(kw)).length;
        if (score > maxScore) {
            maxScore = score;
            bestAct = actCode;
        }
    }
    
    return {
        act: bestAct,
        actName: ACT_DEF[bestAct].name,
        actColor: ACT_DEF[bestAct].color
    };
}

/**
 * 分析客户回应类型
 */
function analyzeCustomerResponse(content, speaker) {
    if (speaker !== 'customer') return null;
    
    const positive = ['好', '可以', '行', '没问题', '了解', '明白'];
    const negative = ['不用', '不要', '贵', '考虑', '再想想'];
    const neutral = ['嗯', '哦', '啊'];
    
    if (positive.some(kw => content.includes(kw))) return 'positive';
    if (negative.some(kw => content.includes(kw))) return 'negative';
    if (neutral.some(kw => content.includes(kw))) return 'neutral';
    return 'neutral';
}

/**
 * 生成内容摘要
 */
function generateSummary(content, stage, topic) {
    // 简化摘要：取前20字 + 主题信息
    const shortContent = content.substring(0, 30);
    return `${STAGE_DEF[stage].name}-${TOPIC_DEF[topic]?.name || ''}: ${shortContent}...`;
}

/**
 * S-T-A完整分析流程
 */
function analyzeSTA(asrText, callMetadata = {}) {
    const segments = parseASRText(asrText);
    const staSegments = [];
    
    for (const seg of segments) {
        const stageInfo = detectStage(seg.content);
        const topicInfo = detectTopic(seg.content, stageInfo.stage);
        const actInfo = detectAct(seg.content, seg.speaker);
        const response = analyzeCustomerResponse(seg.content, seg.speaker);
        
        staSegments.push({
            ...seg,
            stage: stageInfo.stage,
            stageName: stageInfo.stageName,
            topic: topicInfo.topic,
            topicName: topicInfo.topicName,
            act: actInfo.act,
            actName: actInfo.actName,
            actColor: actInfo.actColor,
            customerResponse: response,
            confidence: stageInfo.confidence,
            contentSummary: generateSummary(seg.content, stageInfo.stage, topicInfo.topic)
        });
    }
    
    // 转化分析
    const isConverted = callMetadata.reason_type_name?.includes('有意向') || 
                       callMetadata.reason_type_name?.includes('已约');
    
    const keyActs = staSegments
        .filter(s => s.speaker === 'sales' && s.act)
        .slice(-3)
        .map(s => s.act);
    
    return {
        call_id: callMetadata.call_id || '',
        clue_id: callMetadata.clue_id || '',
        audio_date: callMetadata.audio_date || '',
        call_type: callMetadata.call_type || '',
        reason_type_name: callMetadata.reason_type_name || '',
        metadata: {
            sales_tall_cnt: callMetadata.sales_tall_cnt || 0,
            customer_tall_cnt: callMetadata.customer_tall_cnt || 0,
            audio_duration: callMetadata.audio_duration || 0
        },
        segments: staSegments,
        conversionAnalysis: {
            isConverted: isConverted,
            conversionPoint: isConverted ? '客户表达意向，确认后续跟进' : '',
            keyActs: keyActs,
            customerSentiment: 'positive'
        }
    };
}

// ============================================
// 文件上传与处理 (V5: 支持GBK编码自动检测)
// ============================================

/**
 * 检测并转换编码 (GBK/UTF-8自动识别)
 */
function decodeTextWithEncoding(buffer) {
    // 首先尝试 UTF-8
    try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        const utf8Text = utf8Decoder.decode(buffer);
        // 检查是否包含乱码特征
        if (!utf8Text.includes('��') && !utf8Text.includes('�')) {
            return utf8Text;
        }
    } catch (e) {
        // UTF-8 解码失败，尝试 GBK
    }
    
    // 尝试 GBK/GB18030
    try {
        const gbkDecoder = new TextDecoder('gb18030', { fatal: false });
        return gbkDecoder.decode(buffer);
    } catch (e) {
        // 兜底: 使用 UTF-8 非严格模式
        return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    }
}

/**
 * 检测文本是否为有效的UTF-8中文
 */
function isValidChineseText(text) {
    // 检查常见乱码字符
    const garbledPattern = /[���|����|锟斤拷|�]/;
    if (garbledPattern.test(text)) {
        return false;
    }
    
    // 检查是否包含中文字符
    const chinesePattern = /[\u4e00-\u9fa5]/;
    return chinesePattern.test(text);
}

function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    showNotification(`正在解析 ${file.name}...`, 'info');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            let data;
            if (file.name.endsWith('.csv')) {
                // V5: 使用 ArrayBuffer 读取以支持编码检测
                const buffer = e.target.result;
                let text = decodeTextWithEncoding(buffer);
                
                // 二次校验: 如果检测到乱码，尝试 GBK
                if (!isValidChineseText(text)) {
                    const gbkDecoder = new TextDecoder('gb18030', { fatal: false });
                    text = gbkDecoder.decode(buffer);
                }
                
                data = parseStandardCSV(text);
            } else if (file.name.endsWith('.xlsx')) {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                data = XLSX.utils.sheet_to_json(sheet);
            }
            
            AppState.currentDataSource = data;
            processImportedData(data);
            showNotification(`成功导入 ${data.length} 条通话记录`, 'success');
        } catch (err) {
            showNotification('解析失败: ' + err.message, 'error');
            console.error('Parse error:', err);
        }
    };
    
    if (file.name.endsWith('.xlsx')) {
        reader.readAsBinaryString(file);
    } else {
        // V5: CSV 使用 ArrayBuffer 读取以支持编码检测
        reader.readAsArrayBuffer(file);
    }
}

/**
 * 解析标准数据源CSV格式
 */
function parseStandardCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        // 简单CSV解析（处理带引号的字段）
        const values = lines[i].split(',');
        const row = {};
        
        headers.forEach((h, idx) => {
            let val = values[idx] || '';
            val = val.trim().replace(/^"|"$/g, '');
            row[h] = val;
        });
        
        data.push(row);
    }
    return data;
}

function processImportedData(data) {
    AppState.staResults = [];
    
    // 处理前10条作为示例
    const sampleSize = Math.min(10, data.length);
    
    for (let i = 0; i < sampleSize; i++) {
        const row = data[i];
        const staResult = analyzeSTA(row.asr, {
            call_id: row.call_id,
            clue_id: row.clue_id,
            audio_date: row.audio_date,
            call_type: row.call_type,
            reason_type_name: row.reason_type_name,
            sales_tall_cnt: row.sales_tall_cnt,
            customer_tall_cnt: row.customer_tall_cnt,
            audio_duration: row.audio_duration
        });
        
        AppState.staResults.push(staResult);
    }
    
    displaySTAResults();
    updateGraphFromSTA();
    
    showSyncNotification({
        total: data.length,
        analyzed: sampleSize,
        stages: countStages()
    });
}

function countStages() {
    const counts = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };
    for (const result of AppState.staResults) {
        for (const seg of result.segments) {
            counts[seg.stage] = (counts[seg.stage] || 0) + 1;
        }
    }
    return counts;
}

// ============================================
// S-T-A 结果展示
// ============================================

function displaySTAResults() {
    const container = document.getElementById('upload-result');
    if (!container) return;
    
    let html = `
        <div class="sta-results">
            <h3>S-T-A 结构化分析结果 (${AppState.staResults.length} 条通话)</h3>
            <div class="sta-list">
    `;
    
    for (const result of AppState.staResults) {
        const conversionBadge = result.conversionAnalysis.isConverted 
            ? '<span class="conversion-badge success">✓ 转化</span>' 
            : '<span class="conversion-badge">○ 未转化</span>';
        
        html += `
            <div class="sta-call-item">
                <div class="call-header">
                    <span class="call-id">${result.call_id.substring(0, 16)}...</span>
                    <span class="call-date">${result.audio_date}</span>
                    ${conversionBadge}
                </div>
                <div class="call-meta">
                    销售: ${result.metadata.sales_tall_cnt}轮 | 
                    客户: ${result.metadata.customer_tall_cnt}轮 | 
                    结果: ${result.reason_type_name}
                </div>
                <div class="segments-preview">
                    ${result.segments.slice(0, 3).map(seg => `
                        <div class="segment-item">
                            <span class="seg-time">${seg.timestamp}</span>
                            <span class="seg-speaker ${seg.speaker}">${seg.speaker === 'sales' ? '销售' : '客户'}</span>
                            <span class="seg-sta">
                                <span class="sta-badge stage-${seg.stage.toLowerCase()}">${seg.stage}</span>
                                <span class="sta-badge topic">${seg.topic}</span>
                                ${seg.act ? `<span class="sta-badge act" style="background:${seg.actColor}">${seg.act}</span>` : ''}
                            </span>
                            <span class="seg-content">${seg.content.substring(0, 40)}${seg.content.length > 40 ? '...' : ''}</span>
                        </div>
                    `).join('')}
                    ${result.segments.length > 3 ? `<div class="more-segments">还有 ${result.segments.length - 3} 段对话...</div>` : ''}
                </div>
            </div>
        `;
    }
    
    html += `
            </div>
            <div class="sta-export">
                <button class="btn btn-primary" onclick="exportSTAToJSON()">导出 S-T-A JSON</button>
                <button class="btn btn-secondary" onclick="exportToNeo4j()">导出 Neo4j 导入格式</button>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

function exportSTAToJSON() {
    const dataStr = JSON.stringify(AppState.staResults, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sta_analysis_results.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('S-T-A JSON 已导出', 'success');
}

function exportToNeo4j() {
    // 生成Neo4j Cypher语句
    const cyphers = [];
    
    for (const result of AppState.staResults) {
        // 创建通话节点
        cyphers.push(`CREATE (c:Call {id: '${result.call_id}', clueId: '${result.clue_id}', date: '${result.audio_date}', converted: ${result.conversionAnalysis.isConverted}})`);
        
        // 创建片段节点和关系
        for (const seg of result.segments) {
            cyphers.push(`CREATE (s${seg.sequence}:Segment {sequence: ${seg.sequence}, content: '${seg.content.substring(0, 50).replace(/'/g, "\\'")}', stage: '${seg.stage}', topic: '${seg.topic}', act: '${seg.act || ''}'})`);
            cyphers.push(`CREATE (c)-[:HAS_SEGMENT {order: ${seg.sequence}}]->(s${seg.sequence})`);
        }
    }
    
    const cypherStr = cyphers.join('\n');
    const blob = new Blob([cypherStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neo4j_import.cypher';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('Neo4j Cypher 已导出', 'success');
}

// ============================================
// 图谱可视化
// ============================================

function initGraph() {
    AppState.graphData = generateMockGraphData();
}

function generateMockGraphData() {
    const nodes = [];
    const links = [];
    
    // 生成所有 Stage-Topic 节点
    for (const [stageCode, stage] of Object.entries(STAGE_TOPIC_DEF)) {
        for (const [topicCode, topic] of Object.entries(stage.topics)) {
            nodes.push({
                id: `${stageCode}-${topicCode}`,
                stage: stageCode,
                topic: topicCode,
                name: topic.name,
                group: stageCode,
                frequency: Math.floor(Math.random() * 100) + 20
            });
        }
    }
    
    // 生成正向迁移边
    for (let i = 0; i < nodes.length - 1; i++) {
        if (Math.random() > 0.3) {
            const targetIdx = Math.floor(Math.random() * (nodes.length - i - 1)) + i + 1;
            const prob = Math.random() * 0.5 + 0.3;
            links.push({
                source: nodes[i].id,
                target: nodes[targetIdx].id,
                type: 'C',
                probability: prob,
                pathType: 'forward'
            });
        }
    }
    
    // 生成逆向跳转边
    for (let i = 0; i < 5; i++) {
        const sourceIdx = Math.floor(Math.random() * (nodes.length - 5)) + 5;
        const targetIdx = Math.floor(Math.random() * sourceIdx);
        links.push({
            source: nodes[sourceIdx].id,
            target: nodes[targetIdx].id,
            type: 'D',
            probability: Math.random() * 0.2 + 0.1,
            pathType: 'backward'
        });
    }
    
    return { nodes, links };
}

function updateGraphFromSTA() {
    // 根据S-T-A结果更新图谱数据
    const nodes = [];
    const links = [];
    const nodeFreq = {};
    const linkFreq = {};
    
    // 统计频次
    for (const result of AppState.staResults) {
        for (let i = 0; i < result.segments.length; i++) {
            const seg = result.segments[i];
            const nodeId = `${seg.stage}-${seg.topic}`;
            
            nodeFreq[nodeId] = (nodeFreq[nodeId] || 0) + 1;
            
            // 计算迁移
            if (i > 0) {
                const prevSeg = result.segments[i - 1];
                const linkKey = `${prevSeg.stage}-${prevSeg.topic}-${seg.stage}-${seg.topic}`;
                linkFreq[linkKey] = (linkFreq[linkKey] || 0) + 1;
            }
        }
    }
    
    // 创建节点
    for (const [nodeId, freq] of Object.entries(nodeFreq)) {
        const [stageCode, topicCode] = nodeId.split('-');
        const topicDef = TOPIC_DEF[topicCode];
        if (topicDef) {
            nodes.push({
                id: nodeId,
                stage: stageCode,
                topic: topicCode,
                name: topicDef.name,
                group: stageCode,
                frequency: freq
            });
        }
    }
    
    // 创建边
    for (const [linkKey, freq] of Object.entries(linkFreq)) {
        const parts = linkKey.split('-');
        const sourceId = `${parts[0]}-${parts[1]}`;
        const targetId = `${parts[2]}-${parts[3]}`;
        
        links.push({
            source: sourceId,
            target: targetId,
            type: 'C',
            probability: freq / (nodeFreq[sourceId] || 1),
            pathType: 'forward'
        });
    }
    
    AppState.graphData = { nodes, links };
}

function renderGraph() {
    const container = document.getElementById('graph-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    const width = container.clientWidth;
    const height = container.clientHeight || 600;
    
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
        .force('link', d3.forceLink(data.links).id(d => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-400))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(50));
    
    // 绘制边
    const link = g.append('g')
        .selectAll('line')
        .data(data.links)
        .join('line')
        .attr('class', d => `link ${d.pathType}`)
        .attr('stroke-width', d => Math.max(1.5, d.probability * 6));
    
    // 绘制边标签
    const linkLabel = g.append('g')
        .selectAll('text')
        .data(data.links)
        .join('text')
        .attr('class', 'link-label')
        .attr('font-size', '10px')
        .attr('text-anchor', 'middle')
        .text(d => `${Math.round(d.probability * 100)}%`);
    
    // 绘制节点
    const node = g.append('g')
        .selectAll('g')
        .data(data.nodes)
        .join('g')
        .attr('class', 'node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));
    
    // 节点圆形
    node.append('circle')
        .attr('r', d => Math.sqrt(d.frequency) * 3 + 15)
        .attr('fill', d => STAGE_DEF[d.stage].color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
    
    // Topic名称
    node.append('text')
        .attr('dy', d => Math.sqrt(d.frequency) * 3 + 30)
        .attr('text-anchor', 'middle')
        .text(d => d.name)
        .attr('fill', '#333')
        .attr('font-size', '11px');
    
    // Stage代码
    node.append('text')
        .attr('dy', 4)
        .attr('text-anchor', 'middle')
        .text(d => d.stage)
        .attr('fill', '#fff')
        .attr('font-size', '10px')
        .attr('font-weight', 'bold');
    
    // 更新位置
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        linkLabel
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2);
        
        node.attr('transform', d => `translate(${d.x},${d.y})`);
    });
    
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
}

// ============================================
// 通知系统
// ============================================

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => notif.remove(), 3000);
}

function showSyncNotification(data) {
    const notif = document.createElement('div');
    notif.className = 'sync-notification';
    notif.innerHTML = `
        <div class="sync-content">
            <span class="sync-icon">✓</span>
            <div>
                <strong>S-T-A 分析完成</strong>
                <span>共 ${data.total} 条，已分析 ${data.analyzed} 条</span>
                <div class="stage-stats">
                    S1:${data.stages.S1 || 0} S2:${data.stages.S2 || 0} 
                    S3:${data.stages.S3 || 0} S4:${data.stages.S4 || 0} S5:${data.stages.S5 || 0}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(notif);
    
    setTimeout(() => notif.remove(), 6000);
}

// ============================================
// 导出全局函数
// ============================================

window.login = login;
window.navigateTo = navigateTo;
window.handleFileUpload = handleFileUpload;
window.toggleStage = toggleStage;
window.selectTopic = selectTopic;
window.exportSTAToJSON = exportSTAToJSON;
window.exportToNeo4j = exportToNeo4j;

// ============================================
// 实时推荐系统 (v4.1新增)
// ============================================

let recommendationEngine = null;
let conversationHistory = [];

/**
 * 初始化推荐引擎
 */
function initRecommendationEngine() {
    if (!AppState.staResults || AppState.staResults.length === 0) {
        return false;
    }
    
    // 构建图谱
    const builder = new Neo4jGraphBuilder();
    builder.analyzeSTAResults(AppState.staResults);
    const graphData = builder.exportGraphJSON();
    
    // 初始化推荐引擎
    recommendationEngine = new RecommendationEngine(graphData);
    return true;
}

/**
 * 分析并推荐
 */
function analyzeAndRecommend() {
    const input = document.getElementById('customer-input');
    const content = input.value.trim();
    
    if (!content) {
        showNotification('请输入客户说的话', 'error');
        return;
    }
    
    // 初始化推荐引擎
    if (!recommendationEngine) {
        if (!initRecommendationEngine()) {
            showNotification('请先上传数据文件以构建推荐图谱', 'error');
            return;
        }
    }
    
    // 识别当前Topic
    const stageInfo = detectStage(content);
    const topicInfo = detectTopic(content, stageInfo.stage);
    
    const currentTopicId = `${stageInfo.stage}-${topicInfo.topic}`;
    
    // 添加到对话历史
    conversationHistory.push({
        speaker: 'customer',
        content: content,
        stage: stageInfo.stage,
        topic: topicInfo.topic,
        timestamp: new Date().toLocaleTimeString()
    });
    updateConversationHistory();
    
    // 生成推荐
    const recommendation = recommendationEngine.generateRecommendation(
        currentTopicId,
        content.substring(0, 30)
    );
    
    if (recommendation) {
        displayRecommendation(recommendation);
    } else {
        showNotification('暂无推荐数据，请尝试其他话题', 'warning');
    }
}

/**
 * 显示推荐结果
 */
function displayRecommendation(rec) {
    const container = document.getElementById('recommendation-result');
    container.style.display = 'block';
    
    // 更新推荐卡片
    const card = container.querySelector('.recommendation-card');
    
    card.querySelector('.rec-topic-flow').textContent = 
        `${rec.currentTopic.name} → ${rec.nextTopic.name}`;
    card.querySelector('.rec-confidence').textContent = 
        `${Math.round(rec.confidence * 100)}%`;
    card.querySelector('.rec-act').textContent = 
        `${rec.coreAct} (${rec.actCode})`;
    card.querySelector('.rec-script').textContent = rec.scriptTemplate;
    card.querySelector('.rec-reason').textContent = rec.reason;
    
    // 路径预览
    const pathHtml = rec.pathPreview.map((p, i) => `
        <span class="rec-path-item">${p.topic}</span>
        ${i < rec.pathPreview.length - 1 ? '<span class="rec-path-arrow">→</span>' : ''}
    `).join('');
    
    const pathContainer = card.querySelector('.rec-path');
    if (pathContainer) {
        pathContainer.innerHTML = '<strong>路径预览:</strong> ' + pathHtml;
    }
    
    // 备选方案
    const altContainer = container.querySelector('.rec-alternatives');
    if (rec.alternatives && rec.alternatives.length > 0) {
        altContainer.innerHTML = '<h4>备选策略</h4>' + 
            rec.alternatives.map(alt => `
                <div class="rec-alternative-item">
                    <div class="rec-alt-act">${alt.act}</div>
                    <div class="rec-alt-reason">${alt.reason}</div>
                </div>
            `).join('');
    }
}

/**
 * 模拟客户输入
 */
function simulateCustomerInput() {
    const samples = [
        '我已经试驾过其他品牌了，你们智己的车价格有点贵',
        '这个续航600公里是真的吗？电池衰减怎么办？',
        '我现在还在对比比亚迪和特斯拉，还没决定',
        '可以微信发我详细资料吗？我这周末想去试驾',
        '你们这个优惠政策持续到什么时候？'
    ];
    
    const randomSample = samples[Math.floor(Math.random() * samples.length)];
    document.getElementById('customer-input').value = randomSample;
}

/**
 * 复制话术
 */
function copyScript() {
    const script = document.querySelector('.rec-script');
    if (script) {
        navigator.clipboard.writeText(script.textContent).then(() => {
            showNotification('话术已复制', 'success');
        });
    }
}

/**
 * 更新对话历史显示
 */
function updateConversationHistory() {
    const container = document.getElementById('conversation-history');
    if (!container) return;
    
    container.innerHTML = conversationHistory.map(item => `
        <div class="history-item">
            <span class="history-speaker ${item.speaker}">
                ${item.speaker === 'customer' ? '客户' : '销售'}
            </span>
            <span class="history-content">${item.content}</span>
            ${item.stage ? `
                <span class="history-sta">
                    <span class="sta-badge stage-${item.stage.toLowerCase()}">${item.stage}</span>
                </span>
            ` : ''}
        </div>
    `).join('');
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 导出实时推荐函数
window.analyzeAndRecommend = analyzeAndRecommend;
window.simulateCustomerInput = simulateCustomerInput;
window.copyScript = copyScript;
