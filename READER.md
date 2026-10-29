# 沫鱼阅读器

点击顶部的书本图标，或首页「我的书架」打开。版本 1.6.0。

## 本地电子书

- 点击「导入书籍」，可多选 TXT / EPUB，单本不超过 50 MB。相同文件重复导入会保留原有进度。
- 导入时复制到本机资料目录，之后移动原始文件不影响阅读。
- TXT 自动识别 UTF-8、带 BOM 的 UTF-16、GB18030 / GBK，按中文章回、Chapter 标题生成目录；没有标题时分段。相邻重复的章名不会生成重复目录。
- EPUB 使用 epub.js，支持原书目录、图片、分页、封面、CFI 阅读位置。不支持 DRM 加密书籍；书内 JavaScript、外部链接和外部网络资源关闭。
- 书名、章节名、返回书架、换源、书签和阅读设置集中在阅读页底部，固定一行展示。窄窗口下收紧按钮间距，阅读方式只显示图标，长书名和章节名省略显示。字号、行距、正文宽度、宋体 / 雅黑、纸张 / 纯白 / 护眼 / 夜读背景可在底部阅读设置中调整。
- 支持目录搜索、正文搜索（最多 100 条）、书签。在线书籍的正文搜索仅覆盖已缓存章节。底部不显示阅读进度条和百分比，阅读位置仍自动保存，返回书架后可继续阅读。
- 底栏高度为 40 px；左右翻页模式的「当前页 / 本章页数」也显示在底栏，与其他信息和按钮保持一行。带加号的书签用于添加当前位置，已添加时显示勾选书签，带列表线条的书签用于查看所有书签。
- TXT、在线小说和 EPUB 均可通过底部「滚动 / 翻页」按钮切换上下滚动与左右翻页，选择会自动保存。左右翻页时，点击正文左半边上一页、右半边下一页；选中或拖选文字不会误翻页。章末继续下一章，章首页向前翻回上一章末页。
- 上下滚动为连续阅读：临近章末自动接上下一章，向上可接回上一章，不必点击换章。透明背景下同样支持鼠标滚轮和滚动快捷键。相邻章节按需加载，在线加载失败可重试，已读正文继续保留。
- 底部左右箭头固定切换上一章 / 下一章，第一章和最后一章的相应按钮禁用。键盘 ← / →、PageUp / PageDown、空格用于翻页。切换阅读方式、修改字体和调整窗口时保留当前阅读位置；正文末尾不再插入「本章完 / 下一章」按钮。
- 自动保存阅读位置。移除书架中的书籍时，副本移到 `reader/removed`，不删除用户原始文件。

## 透明阅读与快捷键

在底部「阅读设置 → 阅读外观」选择「透明」，会同时隐藏应用顶部与阅读底部工具栏，窗口和正文背景完全透明，文字为纯黑色。TXT、在线小说和 EPUB 都支持。透明仅作用于背景，文字保持不透明；退出后恢复原来的阅读背景和窗口透明度。透明状态下仍可使用键盘翻页、换章和滚动。

默认 `Ctrl+Shift+T` 切换透明阅读，`Esc` 始终可以退出透明状态。透明状态下切换快捷键也可以从其他应用中恢复本程序；点击系统托盘图标同样会恢复普通阅读界面。`Ctrl+,` 打开阅读设置。透明状态切换到其他面板时也会恢复工具栏。

「阅读设置 → 快捷键」可以点击按键自行修改。重复按键和系统、浏览器保留键不会被保存。透明切换需要 Ctrl、Alt、Win 组合键或功能键；若被其他程序占用，进入透明前会提示更换。设置会保存在本机资料中，可一键恢复默认。

| 操作 | 默认快捷键 |
| --- | --- |
| 上一页 / 下一页 | ← / → |
| 上一章 / 下一章 | Ctrl+← / Ctrl+→ |
| 向上 / 向下滚动 | ↑ / ↓ |
| 切换透明阅读 | Ctrl+Shift+T |
| 打开阅读设置 | Ctrl+, |

上下滚动键可以单独启用、关闭并调整速度（1–10），仅在上下滚动模式中生效，按住可连续滚动。PageUp / PageDown 与空格保留为翻页按键；`Ctrl+F` 搜索正文、`Ctrl+D` 添加或取消书签，`Ctrl+Shift+Space` 保留为原来的全局显示 / 隐藏窗口快捷键。

## 书源

默认内置并启用笔趣阁（www.bqquge.org）、番茄小说（fanqienovel.com）和玄幻文学（m.xhwx8.com），无需先导入书源，打开「找小说」即可搜索。已有资料首次升级时会补齐缺少的书源；同站点已有配置保持原样。之后手动停用或移除的书源不会在重启时自动恢复，仍可导入自己的配置。

项目的 `examples/中华典藏书源.json` 可直接导入，用于古典小说与名著；免安装版中位于 exe 同目录。2026-10-27 已通过本项目的请求和解析流程验证：搜索「西游记」可找到吴承恩版本，读取 100 回目录和第一回正文。网站后续改版可能影响规则。

可直接粘贴 Yiove 的 `https://shuyuan.yiove.com/book-sources?page=1&page_size=20` 列表页链接，程序按原页码和每页数量转换为网站的 JSON 导出接口，仅导入该页，不自动遍历整个仓库。也支持网站「获取本页书源直链」给出的 `https://shuyuan-api.yiove.com/import/book-sources/1-20`。导入使用独立 Chromium 会话，兼容性仍由每个书源的实际规则决定；仓库标注「有效」不等于本阅读器支持。

可直接使用默认书源，也可在「书源管理」导入 JSON / JSON5 文件或 HTTP(S) 书源链接，然后到「找小说」搜索，点击「加入书架」。也可导入 eReader 的静态 `source.ts`：只解析其中的对象数据，不执行 TypeScript。初次打开加载目录，读过的章节缓存在本机，之后可离线重读。搜索显示各书源的第一页结果，可随时停止；切换下拉框会取消旧搜索并按当前关键词重新搜索。每个书源分别显示结果数量、无结果、解析失败或 HTTP 错误，可单独重试。目录面板支持更新在线目录；目录顺序发生变化会清除按旧序号缓存的章节，通过章节链接重新定位阅读进度和书签，已经删除的章节不保留书签。

在线阅读页底部「切换书源」按当前书名搜索其他已启用书源，并核对书名和作者。选中后先加载新目录与当前位置的正文，成功才保存切换。优先按章节名称续读，未匹配时按原章节序号定位并提示核对；序号超出新目录时使用最后一章。匹配到的书签随之迁移，原书源缓存、进度和书签保留在本机。切换失败保留原书源。

搜索遇到人机验证页时，标记「已跳过」并继续其他书源，本次运行后续搜索也会跳过它，不要求打开网站验证。重启程序或在书源管理中停用后重新启用，可重新尝试该书源。导入链接本身需要验证时，仅跳过该次导入。JSON / 静态 source.ts 中引用的验证检测文字不会被当成验证网页。

403 表示网站拒绝访问，不等同于配置无法识别；普通拒绝访问仍显示 HTTP 错误。请求使用 Chromium 网络栈、来源地址、静态请求头及该书源独立的 Cookie 会话；不会读取普通浏览页面的登录信息。网站下线、持续拒绝访问、动态接口及付费限制无法由兼容规则解决。

支持以下三类配置。阅读 3.0 的脚本规则由独立 QuickJS WASM 沙箱执行，声明式规则保留原解析路径；不需要逐个删除脚本兼容性限制。

书源管理会统计「规则兼容」和「暂不支持」，可按兼容性筛选，兼容的书源优先显示。具体原因可展开查看。只检查搜索和阅读实际用到的规则，未使用的发现页、登录规则与注释不会影响兼容性判断；规则兼容不代表网站一定在线或可以免登录访问。

静态请求头和搜索请求参数支持 JSON / JSON5，包括单引号、注释和末尾逗号。阅读 3.0 还支持动态请求头、`@js:` / `<js>`、内联 JS 后处理、共享 `jsLib` 和任意沙箱内 `{{表达式}}`，JSONPath 可用于搜索、详情、目录和正文，支持列表、递归、过滤及动态链接。

常见分页写法 `{{page == 1 ? '' : '/' + page}}` 有直接替换路径；其他表达式交给脚本沙箱。支持 `p.1` / `a.0` 标签索引、`class.dir clear` 多 class 匹配及 `text.下一页@href` 精确文本链接。最新章节与完整目录重复时，按完整目录中的最终位置去重。

脚本环境提供 `source.get/put`、`cache`、`book/chapter`、`java.ajax/get/post/head`、响应 body/header/cookie、CSS / XPath 提取、Jsoup 常用包装、Base64 / URI / 摘要 / AES、`@put/@get` 和独立 Cookie 操作。变量和缓存按书源保存，单源状态上限 2 MB。宿主只开放这些接口，脚本不能读取 Node、系统文件或进程；JSONPath 过滤表达式也在同一沙箱内运行。

1. **eReader JSON**：`name`、`origin`、`search`、`catalogs`、`content`，可导入单个对象、数组或 `{ "local": [...] }`。支持 `rules.wrapContainer`、`rules.infomation`（沿用上游拼写）、`selector`、`nthchild`、`attr`、`handler.replace` 正则替换、正文按行剔除，以及 `pagination.fullpath` / `redirect` 分页路径。静态对象的 `const source = …; export default source;` 包装可直接导入，不执行代码。其他自定义 handler 不执行。
2. **阅读 3.0 书源**：`bookSourceName`、`bookSourceUrl`、`searchUrl`、`ruleSearch`、`ruleBookInfo`、`ruleToc`、`ruleContent`。支持普通 CSS、`@css:`、`class.xxx` / `id.xxx` / `tag.xxx`、索引、`children[0]`、文本 / HTML / 属性、`||` 回退与 `&&` 合并、HTML XPath、字段正则替换和正文 `replaceRegex`。支持 JSONPath、脚本和动态模板、GET / POST / HEAD、UTF-8 / GBK、目录 / 正文下一页。静态正则在独立 Worker 执行；脚本及脚本内正则受沙箱总执行限额控制。
3. **Moyu JSON**：以下为配置模板，`example.com` 是占位地址，需要替换成实际有权访问的网站和 CSS 选择器。阅读器默认不启用在线书源，可按需导入项目附带的示例文件或自己的配置。

```json
{
  "name": "我的书源",
  "baseUrl": "https://example.com",
  "search": {
    "url": "/search?q={{key}}",
    "list": ".book-item",
    "name": ".book-title@text",
    "author": ".author@text",
    "bookUrl": "a@href"
  },
  "info": { "tocUrl": ".chapter-index@href" },
  "toc": {
    "list": ".chapters a",
    "name": "@text",
    "chapterUrl": "@href",
    "next": "a.next-page@href"
  },
  "content": { "text": "#content@text" }
}
```

没有独立详情页目录链接时，删除 `info`。没有目录分页时，删除 `toc.next`。正文分页可添加 `content.next`，必须匹配本章的下一页，不能匹配下一章。

导入只保存数据，搜索 / 阅读时才运行脚本。这里实现的是桌面阅读器的常用接口，并非完整 Android / Rhino / Java 类库；漫画、音视频、交互式登录界面和网站的付费 / DRM 限制不在文字阅读器范围内。遇到缺失宿主方法会显示实际执行错误，网站 401 / 403 / 451、接口下线与网络阻止也会分别显示，不当作脚本不兼容。

普通请求超时 20 秒，脚本请求最多 45 秒；单次脚本操作总时限 90 秒，计算时间限额 5 秒，WASM 内存 96 MB，支持取消。目录最多 30 页，正文最多 12 页，单次响应最多 8 MB，仅访问公开 HTTP(S) 地址。脚本请求可使用普通自定义请求头，Host / 连接控制等头不能覆盖，跨域重定向不转发显式 Authorization / Cookie。

## 数据与开源依赖

源码运行资料：项目根目录下的 `data\browser\reader`，当前为 `E:\study\moyu\data\browser\reader`。
免安装版资料：exe 同目录的 `data\browser\reader`，当前为 `E:\study\moyu\dist\沫鱼-win32-x64\data\browser\reader`。
`library.json` 保存书架、书源、阅读设置和进度，各书籍目录保存副本及缓存。整体备份 `data` 文件夹即可迁移。

- [epub.js](https://github.com/futurepress/epub.js)，BSD-2-Clause，EPUB 解析和排版。
- [JSZip](https://github.com/Stuk/jszip)，MIT（也可选择 GPL-3.0-or-later），EPUB ZIP 预检；此处按 MIT 使用。
- [DOMPurify](https://github.com/cure53/DOMPurify)，Apache-2.0 OR MPL-2.0，书内 HTML 清理。
- [JSON5](https://github.com/json5/json5)，MIT，解析书源的静态请求头与请求参数。
- [iconv-lite](https://github.com/ashtuchkin/iconv-lite)，MIT，按书源要求编码 GBK 等搜索参数。
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)，MIT，隔离的 QuickJS WASM 运行时与异步宿主桥。
- [JSONPath Plus](https://github.com/JSONPath-Plus/JSONPath)，MIT，JSONPath 运行在 QuickJS 客体内。
- [Cheerio](https://github.com/cheeriojs/cheerio)、[xpath](https://github.com/goto100/xpath)、[xmldom](https://github.com/xmldom/xmldom)，MIT，脚本解析的 HTML / XPath 宿主接口。
- [eReader](https://github.com/herozse/eReader) 是小说交互和 JSON 数据格式参考。查阅时仓库未提供明确 LICENSE，本项目没有复制它的实现代码或内置书源。

依赖版本锁定在 package-lock.json，第三方许可证随免安装版保存在 `resources/app/THIRD-PARTY-NOTICES.txt`。
