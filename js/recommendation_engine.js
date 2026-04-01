// ============================================
// Neo4j 图谱构建与查询模块
// 基于S-T-A数据构建话题迁移概率图
// ============================================

/**
 * Neo4j图谱构建器
 * 将S-T-A分析结果转换为Neo4j图结构
 */
class Neo4jGraphBuilder {
    constructor() {
        this.topicStats = new Map();
        this.transitionStats = new Map();
    }

    /**
     * 分析S-T-A结果，统计Topic和Transition
     */
    analyzeSTAResults(staResults) {
        for (const result of staResults) {
            const segments = result.segments;
            
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const topicKey = `${seg.stage}-${seg.topic}`;
                
                // 统计Topic访问频次
                if (!this.topicStats.has(topicKey)) {
                    this.topicStats.set(topicKey, {
                        id: topicKey,
                        name: seg.topicName,
                        stage: seg.stage,
                        stageName: seg.stageName,
                        visitCount: 0,
                        conversionCount: 0
                    });
                }
                this.topicStats.get(topicKey).visitCount++;
                
                // 统计Transition
                if (i > 0) {
                    const prevSeg = segments[i - 1];
                    const prevTopicKey = `${prevSeg.stage}-${prevSeg.topic}`;
                    const transKey = `${prevTopicKey}->${topicKey}`;
                    
                    if (!this.transitionStats.has(transKey)) {
                        this.transitionStats.set(transKey, {
                            from: prevTopicKey,
                            to: topicKey,
                            act: seg.act,
                            actName: seg.actName,
                            count: 0,
                            successCount: 0
                        });
                    }
                    
                    const trans = this.transitionStats.get(transKey);
                    trans.count++;
                    
                    // 判断是否促成转化
                    if (result.conversionAnalysis.isConverted) {
                        trans.successCount++;
                    }
                }
            }
            
            // 标记转化节点
            if (result.conversionAnalysis.isConverted && segments.length > 0) {
                const lastSeg = segments[segments.length - 1];
                const lastTopicKey = `${lastSeg.stage}-${lastSeg.topic}`;
                const topicStat = this.topicStats.get(lastTopicKey);
                if (topicStat) {
                    topicStat.conversionCount++;
                }
            }
        }
        
        // 计算转化率
        for (const topicStat of this.topicStats.values()) {
            topicStat.conversionRate = topicStat.visitCount > 0 
                ? topicStat.conversionCount / topicStat.visitCount 
                : 0;
        }
        
        for (const transStat of this.transitionStats.values()) {
            transStat.conversionRate = transStat.count > 0
                ? transStat.successCount / transStat.count
                : 0;
            
            // 计算迁移概率
            const fromTopic = this.topicStats.get(transStat.from);
            transStat.probability = fromTopic ? transStat.count / fromTopic.visitCount 
                : 0;
        }
    }

    /**
     * 生成Neo4j Cypher语句
     */
    generateCypher() {
        const statements = [];
        
        // 1. 创建Topic节点
        statements.push('// 创建Topic节点');
        for (const topic of this.topicStats.values()) {
            statements.push(`
                CREATE (${this.safeId(topic.id)}:Topic {
                    id: '${topic.id}',
                    name: '${topic.name.replace(/'/g, "\\'")}',
                    stage: '${topic.stage}',
                    stageName: '${topic.stageName}',
                    visitCount: ${topic.visitCount},
                    conversionRate: ${topic.conversionRate.toFixed(4)}
                })
            `);
        }
        
        // 2. 创建Act节点
        statements.push('\n// 创建Act节点');
        const actSet = new Set();
        for (const trans of this.transitionStats.values()) {
            if (trans.act && !actSet.has(trans.act)) {
                actSet.add(trans.act);
                statements.push(`
                    CREATE (${trans.act}:Act {
                        id: '${trans.act}',
                        name: '${trans.actName}',
                        successRate: 0.8
                    })
                `);
            }
        }
        
        // 3. 创建TRANSITION关系
        statements.push('\n// 创建TRANSITION关系');
        for (const trans of this.transitionStats.values()) {
            const fromId = this.safeId(trans.from);
            const toId = this.safeId(trans.to);
            
            statements.push(`
                CREATE (${fromId})-[:TRANSITION {
                    act: '${trans.act || 'A1'}',
                    actName: '${(trans.actName || '未知').replace(/'/g, "\\'")}',
                    count: ${trans.count},
                    probability: ${trans.probability.toFixed(4)},
                    conversionRate: ${trans.conversionRate.toFixed(4)}
                }]->(${toId})
            `);
        }
        
        return statements.join('\n');
    }

    /**
     * 生成安全的Neo4j节点ID
     */
    safeId(topicId) {
        return 't' + topicId.replace(/[^a-zA-Z0-9]/g, '_');
    }

    /**
     * 导出JSON格式的图谱数据
     */
    exportGraphJSON() {
        return {
            nodes: {
                topics: Array.from(this.topicStats.values()),
                acts: Array.from(this.getUniqueActs())
            },
            edges: Array.from(this.transitionStats.values())
        };
    }

    /**
     * 获取唯一的Act列表
     */
    getUniqueActs() {
        const acts = new Map();
        for (const trans of this.transitionStats.values()) {
            if (trans.act && !acts.has(trans.act)) {
                acts.set(trans.act, {
                    id: trans.act,
                    name: trans.actName
                });
            }
        }
        return acts.values();
    }
}

// ============================================
// 推荐算法查询模块 (前端模拟版)
// ============================================

/**
 * 推荐引擎
 * 基于图谱数据生成实时推荐
 */
class RecommendationEngine {
    constructor(graphData) {
        this.topics = graphData.nodes.topics;
        this.transitions = graphData.edges;
        this.topicMap = new Map(this.topics.map(t => [t.id, t]));
        this.transitionMap = this.buildTransitionMap();
    }

    /**
     * 构建Transition查询Map
     */
    buildTransitionMap() {
        const map = new Map();
        for (const trans of this.transitions) {
            if (!map.has(trans.from)) {
                map.set(trans.from, []);
            }
            map.get(trans.from).push(trans);
        }
        return map;
    }

    /**
     * 查找最优路径 (简化版Dijkstra)
     */
    findOptimalPath(currentTopicId, targetStage = 'S5') {
        const visited = new Set();
        const paths = [];
        
        const dfs = (topicId, path, prob) => {
            if (visited.has(topicId)) return;
            visited.add(topicId);
            
            const topic = this.topicMap.get(topicId);
            if (!topic) return;
            
            const newPath = [...path, topic];
            
            // 到达目标Stage
            if (topic.stage === targetStage) {
                paths.push({
                    path: newPath,
                    probability: prob,
                    totalConversion: newPath.reduce((sum, t) => sum + t.conversionRate, 0) / newPath.length
                });
                return;
            }
            
            // 继续搜索
            const transitions = this.transitionMap.get(topicId) || [];
            for (const trans of transitions) {
                dfs(trans.to, newPath, prob * trans.probability);
            }
            
            visited.delete(topicId);
        };
        
        dfs(currentTopicId, [], 1.0);
        
        // 按综合得分排序
        paths.sort((a, b) => b.totalConversion - a.totalConversion);
        return paths.slice(0, 3);
    }

    /**
     * 推荐Acts
     */
    recommendActs(currentTopicId) {
        const transitions = this.transitionMap.get(currentTopicId) || [];
        
        // 排序: 转化率 × 使用频次
        const scored = transitions.map(t => ({
            ...t,
            score: t.conversionRate * Math.log(t.count + 1)
        }));
        
        scored.sort((a, b) => b.score - a.score);
        
        return scored.slice(0, 3).map(t => ({
            act: t.act,
            actName: t.actName,
            toTopicId: t.to,
            toTopicName: this.topicMap.get(t.to)?.name || '',
            conversionRate: t.conversionRate,
            usageCount: t.count,
            score: t.score
        }));
    }

    /**
     * 生成完整推荐
     */
    generateRecommendation(currentTopicId, customerIntent) {
        const paths = this.findOptimalPath(currentTopicId);
        const acts = this.recommendActs(currentTopicId);
        
        if (acts.length === 0) {
            return null;
        }
        
        const bestAct = acts[0];
        const currentTopic = this.topicMap.get(currentTopicId);
        
        return {
            topicTheme: `针对"${customerIntent}"的${bestAct.actName}策略`,
            coreAct: bestAct.actName,
            actCode: bestAct.act,
            currentTopic: {
                id: currentTopicId,
                name: currentTopic?.name || '',
                stage: currentTopic?.stage || ''
            },
            nextTopic: {
                id: bestAct.toTopicId,
                name: bestAct.toTopicName
            },
            scriptTemplate: this.generateScript(bestAct.act, customerIntent),
            reason: `基于历史 ${Math.round(bestAct.conversionRate * 100)}% 的转化概率，此处使用"${bestAct.actName}"能最快切入${bestAct.toTopicName}`,
            confidence: bestAct.conversionRate,
            alternatives: acts.slice(1).map(a => ({
                act: a.actName,
                reason: `转化率 ${Math.round(a.conversionRate * 100)}%，使用频次 ${a.usageCount}次`
            })),
            pathPreview: paths[0]?.path.map(p => ({
                topic: p.name,
                stage: p.stage
            })) || []
        };
    }

    /**
     * 生成话术模板
     */
    generateScript(actCode, customerIntent) {
        const templates = {
            'A1': `您好，我是智己汽车的销售顾问，看到您关注我们的车型。`,
            'A2': `理解您的想法，很多客户一开始也有类似的考虑。`,
            'A3': `关于${customerIntent}，我来为您详细解释一下。智己采用的是...`,
            'A4': `这个优惠活动月底就要截止了，建议您尽快决定。`,
            'A5': `现在下单可以享受置换补贴和免息分期，能帮您节省不少。`,
            'A6': `那您看这周六方便来试驾体验一下吗？`,
            'A7': `您放心，我们有完善的售后保障，全国联保。`
        };
        return templates[actCode] || `针对"${customerIntent}"，我建议...`;
    }
}

// ============================================
// 导出模块
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Neo4jGraphBuilder, RecommendationEngine };
}

// 浏览器环境
if (typeof window !== 'undefined') {
    window.Neo4jGraphBuilder = Neo4jGraphBuilder;
    window.RecommendationEngine = RecommendationEngine;
}
