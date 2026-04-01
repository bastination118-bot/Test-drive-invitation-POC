// ============================================
// Neo4j 图谱构建与查询模块 (V5-Final)
// 基于S-T-A数据构建话题迁移概率图 + 反馈闭环 + 高频过滤
// ============================================

/**
 * 权重更新计算器
 * 公式: NewWeight = (OldWeight * Count + CurrentResult) / (Count + 1)
 */
class WeightCalculator {
    constructor() {
        this.successBoost = 0.1;   // 成功案例加分
        this.failurePenalty = -0.05; // 失败案例扣分
    }

    /**
     * 计算新的权重
     * @param {number} oldWeight - 当前权重 (0-1)
     * @param {number} count - 历史使用次数
     * @param {string} result - 结果类型: 'success' | 'failure' | 'neutral'
     * @returns {number} 新权重
     */
    calculateNewWeight(oldWeight, count, result) {
        let currentResult = 0;
        
        // 根据结果类型确定当前结果值
        if (result === 'success' || result === '有意向' || result === '成功邀约') {
            currentResult = this.successBoost;
        } else if (result === 'failure' || result === '放弃' || result === '拒绝') {
            currentResult = this.failurePenalty;
        } else {
            currentResult = 0;
        }

        // 应用权重更新公式
        const newWeight = (oldWeight * count + currentResult) / (count + 1);
        
        // 确保权重在0-1范围内
        return Math.max(0, Math.min(1, newWeight));
    }

    /**
     * 解析CSV结果字段
     * @param {string} reasonType - reason_type_name字段值
     * @returns {string} 标准化结果类型
     */
    parseResultType(reasonType) {
        if (!reasonType) return 'neutral';
        
        const lowerResult = reasonType.toLowerCase();
        
        // 成功案例关键词
        const successKeywords = ['有意向', '成功', '邀约', '微信', '加', 'ok', '好的'];
        // 失败案例关键词
        const failureKeywords = ['放弃', '拒绝', '无意向', '不考虑', '不买', '挂断'];
        
        if (successKeywords.some(kw => lowerResult.includes(kw))) {
            return 'success';
        }
        if (failureKeywords.some(kw => lowerResult.includes(kw))) {
            return 'failure';
        }
        
        return 'neutral';
    }
}

/**
 * 高频路径过滤器
 * 只渲染累计概率前80%的节点和边
 */
class PathFilter {
    constructor(coverageThreshold = 0.8) {
        this.coverageThreshold = coverageThreshold;
    }

    /**
     * 过滤高频路径
     * @param {Array} transitions - 所有transition边
     * @returns {Object} {filteredTransitions, otherTransitions, stats}
     */
    filterHighFrequencyPaths(transitions) {
        if (!transitions || transitions.length === 0) {
            return { filteredTransitions: [], otherTransitions: [], stats: {} };
        }

        // 按使用频次排序
        const sortedTransitions = [...transitions].sort((a, b) => b.count - a.count);
        
        // 计算总频次
        const totalCount = sortedTransitions.reduce((sum, t) => sum + t.count, 0);
        
        // 累计概率筛选前80%
        let cumulativeCount = 0;
        const filteredTransitions = [];
        const otherTransitions = [];
        
        for (const trans of sortedTransitions) {
            cumulativeCount += trans.count;
            const coverage = cumulativeCount / totalCount;
            
            if (coverage <= this.coverageThreshold) {
                filteredTransitions.push(trans);
            } else {
                otherTransitions.push(trans);
            }
        }

        // 创建"其他"聚合节点
        const otherAggregate = otherTransitions.length > 0 ? {
            from: 'other-sources',
            to: 'other-targets',
            act: 'A0',
            actName: '其他低频路径',
            count: otherTransitions.reduce((sum, t) => sum + t.count, 0),
            probability: otherTransitions.reduce((sum, t) => sum + t.probability, 0) / otherTransitions.length,
            conversionRate: otherTransitions.reduce((sum, t) => sum + t.conversionRate, 0) / otherTransitions.length,
            isAggregate: true
        } : null;

        return {
            filteredTransitions,
            otherTransitions,
            otherAggregate,
            stats: {
                totalTransitions: transitions.length,
                filteredCount: filteredTransitions.length,
                otherCount: otherTransitions.length,
                coverage: (filteredTransitions.reduce((sum, t) => sum + t.count, 0) / totalCount * 100).toFixed(1) + '%'
            }
        };
    }

    /**
     * 过滤高频节点
     * @param {Array} topics - 所有topic节点
     * @param {Array} filteredTransitions - 已过滤的边
     * @returns {Array} 过滤后的节点
     */
    filterHighFrequencyNodes(topics, filteredTransitions) {
        // 获取所有出现在高频边中的节点ID
        const activeNodeIds = new Set();
        filteredTransitions.forEach(t => {
            activeNodeIds.add(t.from);
            activeNodeIds.add(t.to);
        });

        // 返回活跃的节点
        return topics.filter(t => activeNodeIds.has(t.id));
    }
}

/**
 * Neo4j图谱构建器 (V5增强版)
 * 将S-T-A分析结果转换为Neo4j图结构 + 权重更新
 */
class Neo4jGraphBuilder {
    constructor() {
        this.topicStats = new Map();
        this.transitionStats = new Map();
        this.weightCalculator = new WeightCalculator();
        this.pathFilter = new PathFilter(0.8); // 80%覆盖率
    }

    /**
     * 分析S-T-A结果，统计Topic和Transition (支持权重更新)
     */
    analyzeSTAResults(staResults) {
        for (const result of staResults) {
            const segments = result.segments;
            const resultType = this.weightCalculator.parseResultType(result.reason_type_name);
            
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
                        conversionCount: 0,
                        successCount: 0,  // V5新增: 成功案例数
                        failureCount: 0   // V5新增: 失败案例数
                    });
                }
                const topicStat = this.topicStats.get(topicKey);
                topicStat.visitCount++;
                
                // 根据结果更新Topic统计
                if (resultType === 'success') {
                    topicStat.successCount++;
                } else if (resultType === 'failure') {
                    topicStat.failureCount++;
                }
                
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
                            successCount: 0,
                            failureCount: 0,
                            weight: 0.5  // 初始权重
                        });
                    }
                    
                    const trans = this.transitionStats.get(transKey);
                    trans.count++;
                    
                    // 根据结果更新权重
                    if (resultType === 'success') {
                        trans.successCount++;
                    } else if (resultType === 'failure') {
                        trans.failureCount++;
                    }
                    
                    // 应用权重更新公式
                    trans.weight = this.weightCalculator.calculateNewWeight(
                        trans.weight,
                        trans.count,
                        resultType
                    );
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
            // 基础转化率
            transStat.conversionRate = transStat.count > 0
                ? transStat.successCount / transStat.count
                : 0;
            
            // 计算迁移概率
            const fromTopic = this.topicStats.get(transStat.from);
            transStat.probability = fromTopic ? transStat.count / fromTopic.visitCount : 0;
            
            // 综合权重 = 基础权重 + 转化率调整
            transStat.displayWeight = transStat.weight * (0.5 + 0.5 * transStat.conversionRate);
        }
    }

    /**
     * 获取过滤后的图谱数据 (高频路径过滤)
     */
    getFilteredGraphData() {
        const allTransitions = Array.from(this.transitionStats.values());
        const allTopics = Array.from(this.topicStats.values());
        
        // 应用高频路径过滤
        const filterResult = this.pathFilter.filterHighFrequencyPaths(allTransitions);
        const filteredTransitions = filterResult.filteredTransitions;
        
        // 如果有低频聚合，添加到结果
        if (filterResult.otherAggregate) {
            filteredTransitions.push(filterResult.otherAggregate);
        }
        
        // 过滤节点
        const filteredTopics = this.pathFilter.filterHighFrequencyNodes(allTopics, filteredTransitions);
        
        return {
            nodes: {
                topics: filteredTopics,
                acts: Array.from(this.getUniqueActs())
            },
            edges: filteredTransitions,
            stats: filterResult.stats
        };
    }

    /**
     * 生成Neo4j Cypher语句 (带权重)
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
                    conversionRate: ${topic.conversionRate.toFixed(4)},
                    successCount: ${topic.successCount || 0},
                    failureCount: ${topic.failureCount || 0}
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
        
        // 3. 创建TRANSITION关系 (带权重)
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
                    conversionRate: ${trans.conversionRate.toFixed(4)},
                    weight: ${trans.weight.toFixed(4)},
                    successCount: ${trans.successCount || 0},
                    failureCount: ${trans.failureCount || 0}
                }]->(${toId})
            `);
        }
        
        return statements.join('\n');
    }

    safeId(topicId) {
        return 't' + topicId.replace(/[^a-zA-Z0-9]/g, '_');
    }

    exportGraphJSON() {
        return {
            nodes: {
                topics: Array.from(this.topicStats.values()),
                acts: Array.from(this.getUniqueActs())
            },
            edges: Array.from(this.transitionStats.values())
        };
    }

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
// 推荐算法查询模块 (V5增强版)
// ============================================

class RecommendationEngine {
    constructor(graphData) {
        this.topics = graphData.nodes.topics;
        this.transitions = graphData.edges;
        this.topicMap = new Map(this.topics.map(t => [t.id, t]));
        this.transitionMap = this.buildTransitionMap();
    }

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
     * 查找最优路径 (V5: 使用displayWeight作为边权重)
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
            
            // 继续搜索 (优先使用displayWeight)
            const transitions = this.transitionMap.get(topicId) || [];
            // 按权重排序，优先探索高权重路径
            const sortedTransitions = [...transitions].sort((a, b) => 
                (b.displayWeight || b.weight || 0.5) - (a.displayWeight || a.weight || 0.5)
            );
            
            for (const trans of sortedTransitions) {
                const transWeight = trans.displayWeight || trans.weight || 0.5;
                dfs(trans.to, newPath, prob * transWeight);
            }
            
            visited.delete(topicId);
        };
        
        dfs(currentTopicId, [], 1.0);
        
        paths.sort((a, b) => b.totalConversion - a.totalConversion);
        return paths.slice(0, 3);
    }

    /**
     * 推荐Acts (V5: 使用displayWeight排序)
     */
    recommendActs(currentTopicId) {
        const transitions = this.transitionMap.get(currentTopicId) || [];
        
        // V5: 排序使用 displayWeight × 使用频次
        const scored = transitions.map(t => ({
            ...t,
            score: (t.displayWeight || t.weight || 0.5) * Math.log(t.count + 1)
        }));
        
        scored.sort((a, b) => b.score - a.score);
        
        return scored.slice(0, 3).map(t => ({
            act: t.act,
            actName: t.actName,
            toTopicId: t.to,
            toTopicName: this.topicMap.get(t.to)?.name || '',
            conversionRate: t.conversionRate,
            usageCount: t.count,
            weight: t.displayWeight || t.weight || 0.5,
            score: t.score
        }));
    }

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
            reason: `基于历史 ${Math.round(bestAct.conversionRate * 100)}% 的转化概率，此处使用"${bestAct.actName}"能最快切入${bestTask.toTopicName}`,
            confidence: bestAct.conversionRate,
            weight: bestAct.weight,
            alternatives: acts.slice(1).map(a => ({
                act: a.actName,
                reason: `转化率 ${Math.round(a.conversionRate * 100)}%，权重 ${(a.weight * 100).toFixed(1)}%`
            })),
            pathPreview: paths[0]?.path.map(p => ({
                topic: p.name,
                stage: p.stage
            })) || []
        };
    }

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
    module.exports = { 
        WeightCalculator, 
        PathFilter, 
        Neo4jGraphBuilder, 
        RecommendationEngine 
    };
}

if (typeof window !== 'undefined') {
    window.WeightCalculator = WeightCalculator;
    window.PathFilter = PathFilter;
    window.Neo4jGraphBuilder = Neo4jGraphBuilder;
    window.RecommendationEngine = RecommendationEngine;
}
