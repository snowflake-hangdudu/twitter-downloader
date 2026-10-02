# X Downloader（Twitter/X 视频下载助手）

浏览器扩展：在 x.com / twitter.com 保存公开推文中的视频、GIF 与图片。

## 功能

- 时间线 / 主页（Posts、Media、Videos、Likes）：推文右上角「下载推文」入口
- 推文详情：悬浮入口，多图勾选下载
- 创作者面板：扫描已加载推文、自动解析媒体、批量入队
- 默认隐藏首页推广推（设置可关）
- 队列：暂停 / 继续 / 取消 / 重试；中英界面与主题

## 开发

```bash
npm test
```

Chrome：扩展管理页加载本目录。Firefox 使用 `manifest.firefox.json`。

远程配置：`http://124.222.62.190:8081/api/config/twitter`（公告数据会拉取；页脚不展示公告。评分需在配置中心填写商店链接并启用后，累计成功下载才会提示跳转）。

## 许可

仅供个人学习使用，请遵守 X 使用条款。
