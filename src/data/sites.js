export const categories = [
  {id: 'recommend', label: '常用'}, {id: 'read', label: '阅读'},
  {id: 'video', label: '影音'}, {id: 'study', label: '学习'}, {id: 'tools', label: '工具'},
];

export const sites = [
  {name: '微信读书', url: 'https://weread.qq.com/', icon: 'book', group: 'read', recommended: true},
  {name: '抖音', url: 'https://www.douyin.com/', icon: 'play', group: 'video', recommended: true},
  {name: '小红书', url: 'https://www.xiaohongshu.com/', icon: 'book', group: 'read', recommended: true},
  {name: '哔哩哔哩', url: 'https://www.bilibili.com/', icon: 'play', group: 'video', recommended: true},
  {name: '番茄小说', url: 'https://fanqienovel.com/', icon: 'book', group: 'read', recommended: true},
  {name: '粉笔', url: 'https://www.fenbi.com/', icon: 'pen', group: 'study', recommended: true},
  {name: '起点中文网', url: 'https://www.qidian.com/', icon: 'book', group: 'read', recommended: true},
  {name: '知乎', url: 'https://www.zhihu.com/', icon: 'globe', group: 'tools', recommended: true},
  {name: '七猫中文网', url: 'https://www.qimao.com/', icon: 'book', group: 'read'},
  {name: '中国大学 MOOC', url: 'https://www.icourse163.org/', icon: 'pen', group: 'study'},
  {name: '力扣', url: 'https://leetcode.cn/', icon: 'pen', group: 'study'},
  {name: '必应', url: 'https://www.bing.com/', icon: 'search', group: 'tools'},
  {name: 'GitHub', url: 'https://github.com/', icon: 'globe', group: 'tools'},
];

export function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
