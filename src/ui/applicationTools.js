/** Skill definitions shared by the toolbar and the skill gallery. */
export const SKILLS = [
  { id: 'skill-web', label: '网页资料整理', agent: 'browser', prompt: '整理网页资料的来源、要点与摘要', icon: 'web' },
  { id: 'skill-plan', label: '工作流程规划', agent: 'computer', prompt: '把当前工作拆解成步骤和检查清单', icon: 'workflow' },
  { id: 'skill-files', label: '文件归档方案', agent: 'file', prompt: '设计项目文件的分类、命名与归档方案', icon: 'archive' },
];
export const APPLICATION_TOOLS = [
  ...SKILLS.map(skill => [skill.id, skill.label, skill.icon]),
  ['clock', '定时任务', 'clock'],
];
