export const officialContentSources = [
  {
    id: 'school-news',
    name: '学校要闻',
    category: 'news',
    url: 'https://news.hufe.edu.cn/hcyw.htm',
    pathIncludes: ['/info/1022/'],
    limit: 12
  },
  {
    id: 'notices',
    name: '通知公告',
    category: 'notices',
    url: 'https://www.hufe.edu.cn/index/tzgg.htm',
    pathIncludes: ['/info/1048/'],
    limit: 12
  },
  {
    id: 'academic',
    name: '学术动态',
    category: 'academic',
    url: 'https://www.hufe.edu.cn/index/xshd.htm',
    pathIncludes: ['/info/1050/'],
    limit: 12
  },
  {
    id: 'alumni-activities',
    name: '校友活动',
    category: 'alumni',
    url: 'https://www.hufe.edu.cn/cxcyx/xyzj/xyhd.htm',
    pathIncludes: ['/info/1621/'],
    limit: 12
  },
  {
    id: 'alumni-stories',
    name: '校友风采',
    category: 'alumniStories',
    url: 'https://www.hufe.edu.cn/cxcyx/xyzj/xyfc.htm',
    pathIncludes: ['/info/1631/'],
    limit: 12
  },
  {
    id: 'alumni-services',
    name: '校友服务',
    category: 'alumniServices',
    url: 'https://www.hufe.edu.cn/cxcyx/xyzj/xyfw.htm',
    pathIncludes: ['/info/1651/', '/info/1731/'],
    limit: 12
  }
]

export const categoryLabels = {
  news: '学校要闻',
  notices: '通知公告',
  academic: '学术动态',
  alumni: '校友活动',
  alumniStories: '校友风采',
  alumniServices: '校友服务'
}
