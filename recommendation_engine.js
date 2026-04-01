/**
 * 智己汽车 S-T-A 推荐引擎 (V5.1-Production)
 * 纯前端内存化实现，无需Neo4j服务器
 */

// ============================================
// Neo4jGraphBuilder - 内存化图谱构建器
// ============================================
class Neo4jGraphBuilder {
    constructor() {
        this.nodes = new Map();
        this.edges = [];
        this.topicStats = new Map();
        this.transitionStats = new Map();
    }

    /**
     * 从S-T-A结果构建内存图谱（核心）
     * @param {Array} staResults - [{call_id, segments: [{stage, topic, act, ...}]}]
     */
    buildFromSTAResults(staResults) {
        if (!staResults || staResults.length === 0) {
            console.warn('buildFromSTAResults: 无数据');
            return this.exportGraphJSON();
        }

        // 1. 统计Topic访问频次
        staResults.forEach(call => {
            if (!call.segments) return;

            call.segments.forEach((seg, idx) => {
                const topicKey = `${seg.stage}-${seg.topic}`;

                // Topic统计
                if (!this.topicStats.has(topicKey)) {
                    this.topicStats.set(topicKey, {
                        id: topicKey,
                        name: seg.topicName || TOPIC_NAMES[seg.topic] || seg.topic,
                        stage: seg.stage,
                        stageName: STAGE_NAMES[seg.stage] || seg.stage,
                        visitCount: 0,
                        conversionCount: 0
                    });
                }
                const topicStat = this.topicStats.get(topicKey);
                topicStat.visitCount++;

                // Transition统计（除第一个segment外）
                if (idx > 0) {
                    const prevSeg = call.segments[idx - 1];
                    const prevKey = `${prevSeg.stage}-${prevSeg.topic}`;
                    const transKey = `${prevKey}->${topicKey}`;

                    if (!this.transitionStats.has(transKey)) {
                        this.transitionStats.set(transKey, {
                            from: prevKey,
                            to: topicKey,
                            act: seg.act || 'A1',
                            actName: ACT_NAMES[seg.act] || '专业沟通',
                            count: 0,
                            successCount: 0,
                            jumpType: this.calculateJumpType(prevSeg.stage, seg.stage)
                        });
                    }
                    const trans = this.transitionStats.get(transKey);
                    trans.count++;
                    if (call.conversionAnalysis?.isConverted) {
                        trans.successCount++;
                    }
                }
            });

            // 标记转化节点（最后一个segment）
            if (call.conversionAnalysis?.isConverted && call.segments.length > 0) {
                const lastSeg = call.segments[call.segments.length - 1];
                const lastKey = `${lastSeg.stage}-${lastSeg.topic}`;
                const topicStat = this.topicStats.get(lastKey);
                if (topicStat) topicStat.conversionCount++;
            }
        });

        // 2. 计算转化率
        this.topicStats.forEach(topic => {
            topic.conversionRate = topic.visitCount > 0 ? topic.conversionCount / topic.visitCount : 0;
        });

        this.transitionStats.forEach(trans => {
            trans.conversionRate = trans.count > 0 ? trans.successCount / trans.count : 0;
            const fromTopic = this.topicStats.get(trans.from);
            trans.probability = fromTopic ? trans.count / fromTopic.visitCount : 0;
        });

        return this.exportGraphJSON();
    }

    calculateJumpType(prevStage, currStage) {
        const stages = ['S1', 'S2', 'S3', 'S4', 'S5'];
        const prevIdx = stages.indexOf(prevStage);
        const currIdx = stages.indexOf(currStage);
        if (currIdx > prevIdx) return 'C';
        if (currIdx === prevIdx) return 'B';
        return 'D';
    }

    exportGraphJSON() {
        return {
            nodes: Array.from(this.topicStats.values()).map(t => ({
                id: t.id,
                name: t.name,
                stage: t.stage,
                group: t.stage,
                frequency: t.visitCount,
                conversionRate: t.conversionRate,
                radius: Math.sqrt(t.visitCount) * 2 + 10
            })),
            edges: Array.from(this.transitionStats.values()).map(e => ({
                source: e.from,
                target: e.to,
                type: e.act,
                actName: e.actName,
                probability: e.probability,
                conversionRate: e.conversionRate,
                count: e.count,
                pathType: e.jumpType === 'D' ? 'backward' : 'forward',
                jumpType: e.jumpType,
                thickness: Math.max(1, e.probability * 5)
            }))
        };
    }
}

// ============================================
// RecommendationEngine - 3选1话术推荐
// ============================================
class RecommendationEngine {
    constructor(graphData) {
        this.graphData = graphData || { nodes: [], edges: [] };
        this.topicMap = new Map(graphData.nodes.map(n => [n.id, n]));
        this.edgesFrom = new Map();

        graphData.edges.forEach(edge => {
            const sourceId = edge.source.id || edge.source;
            if (!this.edgesFrom.has(sourceId)) {
                this.edgesFrom.set(sourceId, []);
            }
            this.edgesFrom.get(sourceId).push(edge);
        });
    }

    /**
     * 生成3选1话术推荐（核心算法）
     */
    generateOptions(currentTopicId, customerIntent) {
        const edges = this.edgesFrom.get(currentTopicId) || [];

        // 排序：转化率 × 使用频次（对数平滑）
        const scored = edges.map(e => ({
            ...e,
            score: e.conversionRate * Math.log(e.count + 1) * 100,
            successRateDisplay: `${(e.conversionRate * 100).toFixed(0)}%`
        }));

        scored.sort((a, b) => b.score - a.score);
        const top3 = scored.slice(0, 3);

        // 补齐到3个
        while (top3.length < 3) {
            top3.push({
                target: { id: 'S5-T5-2', name: '邀约确认' },
                actName: '标准推进',
                conversionRate: 0.5,
                count: 1,
                score: 50,
                successRateDisplay: '50%',
                isDefault: true
            });
        }

        return top3.map((edge, idx) => {
            const targetId = edge.target.id || edge.target;
            const targetNode = this.topicMap.get(targetId);
            return {
                id: `option-${idx}`,
                rank: idx + 1,
                strategyLabel: idx === 0 ? '金牌路径' : idx === 1 ? '稳健推进' : '试探挽回',
                riskLevel: idx === 0 ? 'low' : idx === 1 ? 'medium' : 'high',
                actName: edge.actName,
                toTopicId: targetId,
                toTopicName: targetNode?.name || targetId,
                successRate: edge.successRateDisplay,
                usageCount: edge.count,
                scriptTemplate: this.generateScript(edge.actName, customerIntent, targetId),
                predictedReply: this.simulateCustomerReply(targetId),
                highlightPath: { source: currentTopicId, target: targetId, color: idx === 0 ? '#2E7D32' : '#FF9800' }
            };
        });
    }

    generateScript(actName, intent, targetTopic) {
        const templates = {
            '专业解释': `关于"${intent}"，我来为您专业解释一下。智己采用的是行业领先的技术方案，确实能很好地解决您的顾虑。`,
            '利益诱导': `现在正是最佳时机，针对"${intent}"我们有专项优惠政策，比您之前了解的品牌更有竞争力。`,
            '顾虑打消': `完全理解您对"${intent}"的顾虑，实际上我们的解决方案是业内最成熟的，很多客户最后都选择了我们。`,
            '确认引导': `那关于"${intent}"，您看我们这周六安排试驾详细体验一下？我帮您预留个时间。`,
            '标准推进': `针对"${intent}"，建议我们进一步沟通，我给您详细介绍下我们的优势。`
        };
        return templates[actName] || `针对"${intent}"，建议采用${actName}策略推进到下一步。`;
    }

    simulateCustomerReply(targetTopicId) {
        const replies = [
            "嗯，这样啊，那具体怎么操作？",
            "好的，你能详细说说吗？",
            "这个我之前也了解过，还有别的吗？",
            "那价格大概是多少？",
            "可以，那你帮我预约一下试驾吧",
            "我再考虑考虑，你先发点资料给我"
        ];
        return replies[Math.floor(Math.random() * replies.length)];
    }
}

// ============================================
// 常量定义（仅在未定义时设置，避免重复声明）
// ============================================
if (typeof STAGE_NAMES === 'undefined') {
    window.STAGE_NAMES = {
        'S1': '开场破冰',
        'S2': '需求挖掘',
        'S3': '产品价值传递',
        'S4': '异议处理',
        'S5': '邀约收口'
    };
}

if (typeof TOPIC_NAMES === 'undefined') {
    window.TOPIC_NAMES = {
        'T1-1': '自我介绍与品牌背书',
        'T1-2': '留资意图确认',
        'T1-3': '礼貌寒暄与快速切入',
        'T2-1': '车型偏好确认',
        'T2-2': '试驾需求确认',
        'T2-3': '购车场景与预算探询',
        'T3-1': '核心配置输出',
        'T3-2': '价格/优惠政策传递',
        'T3-3': '服务优势与差异化',
        'T4-1': '价格顾虑化解',
        'T4-2': '试驾相关顾虑化解',
        'T4-3': '异地/售后顾虑化解',
        'T5-1': '微信留资邀约',
        'T5-2': '试驾时间确认',
        'T5-3': '后续跟进确认'
    };
}

if (typeof ACT_NAMES === 'undefined') {
    window.ACT_NAMES = {
        'A1': '专业解释',
        'A2': '确认引导',
        'A3': '利益诱导',
        'A4': '时间锚定',
        'A5': '优惠强调',
        'A6': '留白引导',
        'A7': '简单结束'
    };
}

// 导出
if (typeof window !== 'undefined') {
    window.Neo4jGraphBuilder = Neo4jGraphBuilder;
    window.RecommendationEngine = RecommendationEngine;
}
