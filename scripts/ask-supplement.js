#!/usr/bin/env node
const { createSuccessResult, createErrorResult } = require('./lib/result-helper');

/**
 * 分析用户提问，返回可操作的补充建议。
 *
 * 输入：
 *   --question   用户的提问文本
 *   --note-content  当前笔记的完整 markdown（用于判断已有内容、找 TODO）
 *   --paper-title   论文标题（可选，用于相关性判断）
 *
 * 输出：
 *   shouldSupplement  是否建议补充
 *   targetSection     建议补充到哪个区域
 *   reason            判断理由
 *   existingTODOs     笔记中当前的 TODO 区域列表
 *   fillAction        给 AI 的执行建议（直接可用的操作描述）
 */

function findStructure(noteContent) {
  const sections = [];
  const lines = (noteContent || '').split('\n');
  let current = null;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      current = { name: h2[1].trim(), body: '', isEmpty: true, hasTodo: false };
      sections.push(current);
      continue;
    }
    if (current) {
      current.body += line + '\n';
      if (/\[待补充\]/i.test(line)) current.hasTodo = true;
      const t = line.trim();
      if (t && !/^[-\s>#]+$/.test(t) && !/^\[待补充\]$/i.test(t) && !t.startsWith('>')) {
        current.isEmpty = false;
      }
    }
  }
  return sections;
}

function analyze(question, noteContent, paperTitle) {
  const q = (question || '').toLowerCase();
  const sections = findStructure(noteContent);
  const paperTerms = (paperTitle || '').toLowerCase().split(/\s+/).filter(t => t.length > 3);

  // 1. 是否明确要求补充
  const supplementKW = ['记下来', '补充', '添加到笔记', '记录', 'add to note', '记到', '保存', '写进去'];
  const queryKW = ['哪年', '发表', '什么时候', '作者是谁', '多少页', '怎么打开', 'what year', 'when was'];

  const explicitAdd = supplementKW.some(k => q.includes(k));
  const pureQuery = queryKW.some(k => q.includes(k));

  // 2. 匹配最佳区域
  const rules = [
    { s: '研究问题',    kw: ['问题', 'gap', '动机', '为什么', '目的', '目标', '背景', '动机', 'research question', 'motivation'] },
    { s: '方法与实验',  kw: ['方法', '实验', '数据', '模型', '训练', '算法', '架构', '参数', '实现', '数据集', 'method', 'experiment', 'dataset', 'training', 'architecture', 'model'] },
    { s: '核心发现',    kw: ['发现', '结果', '结论', '效果', '性能', '对比', '优于', '提升', 'result', 'performance', 'outperform', 'finding', 'conclusion', 'ablation'] },
    { s: '关键引文',    kw: ['引用', '原文', '引文', 'quote', 'cite', '摘录'] },
    { s: '思考与疑问',  kw: ['思考', '疑问', '不足', '局限', '改进', '未来', 'limitation', 'future', '批评', '批判'] },
    { s: 'User Data',   kw: ['笔记', '记录', '备注', 'note', 'memo'] },
  ];

  let best = null, bestScore = 0;
  for (const r of rules) {
    let score = r.kw.reduce((s, k) => s + (q.includes(k) ? 1 : 0), 0);
    if (r.s === paperTitle) score += 0;
    if (score > bestScore) { bestScore = score; best = r.s; }
  }
  if (!best) best = 'User Data';

  // 3. 是否与论文相关
  const related = paperTerms.length === 0 || paperTerms.some(t => q.includes(t)) || explicitAdd || bestScore > 0;

  // 4. 是否已有重复内容
  let duplicate = false;
  if (best && sections.length > 0) {
    const target = sections.find(s => s.name.includes(best));
    if (target && !target.isEmpty) {
      const qWords = q.replace(/[?？,.!！，。]/g, '').split(/\s+/).filter(w => w.length > 3);
      const matchCount = qWords.filter(w => target.body.toLowerCase().includes(w)).length;
      if (qWords.length > 2 && matchCount >= qWords.length * 0.6) duplicate = true;
    }
  }

  // 5. 决策
  let should = false, conf = 'low', reason = '', fillAction = '';

  if (explicitAdd) {
    should = true; conf = 'high';
    reason = '用户明确要求补充到笔记';
  } else if (pureQuery) {
    reason = '纯事实查询，仅需回答';
  } else if (!related) {
    reason = '与当前论文无关';
  } else if (duplicate) {
    reason = '笔记中已有类似内容';
  } else if (bestScore > 0) {
    should = true; conf = 'medium';
    reason = `问题涉及「${best}」相关内容`;
  } else {
    reason = '无法确定';
  }

  // 6. 找到目标区域对应的 TODO
  const todos = sections.filter(s => s.hasTodo || s.isEmpty).map(s => s.name);
  const targetSection = sections.find(s => s.name.includes(best)) ? best : (todos[0] || 'User Data');
  const targetIsTODO = todos.includes(targetSection);

  if (should) {
    const sectionNote = targetIsTODO ? `（该区域当前为 [待补充]）` : '';
    fillAction = [
      `定位目标文档: lit-note-find.js --key <itemKey>`,
      `追加内容: lit-note-append.js --doc-id <id> --section "${targetSection}" --content "<markdown>"${targetIsTODO ? ' --mode replace' : ''}`,
      targetIsTODO ? '用新内容替换 [待补充] 标记' : '在区域末尾追加新内容'
    ].join(' | ');
  }

  return {
    shouldSupplement: should,
    confidence: conf,
    targetSection,
    targetIsTODO,
    reason,
    fillAction,
    existingTodos: todos,
    suggestion: should
      ? `✅ 建议补充到「${targetSection}」${targetIsTODO ? '（覆盖 [待补充]）' : ''}`
      : `❌ ${reason}`
  };
}

async function main() {
  const args = process.argv.slice(2);
  let question = '', noteContent = '', paperTitle = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--question' && args[i + 1]) question = args[++i];
    if (args[i] === '--note-content' && args[i + 1]) noteContent = args[++i];
    if (args[i] === '--paper-title' && args[i + 1]) paperTitle = args[++i];
  }

  if (!question) {
    console.log(JSON.stringify(createSuccessResult({
      shouldSupplement: false, confidence: 'low', reason: '未提供问题', fillAction: ''
    })));
    return;
  }

  console.log(JSON.stringify(createSuccessResult(analyze(question, noteContent, paperTitle))));
}

main();
