# Pixel Sprite Animator：浏览器本地导出共享版

公网网页只负责提供界面、素材和访问控制。每位访客的框选、预览、图层合成和透明 PNG、PNG Sequence、GIF、MOV 导出都在访客自己的浏览器与电脑上完成；帧不会上传到这台 Mac，也不会调用 Mac FFmpeg。所有导出均默认透明。

本地开发和公网发布现在分开：本地入口 `4174` 直接读取项目里的 `public/` 工作目录；公网入口 `4173` 读取 `.runtime/public-shared/` 已发布快照。本地修改不会自动出现在公网，只有执行 `npm run share:publish` 后才会同步。

## 当前临时分享

运行 `npm run share:status` 查看当前分享网址。打开网址后，在网页输入一次访问码（由 `PIXEL_SPRITE_ACCESS_KEY` 配置，未配置时本机随机生成），浏览器会保存仅当前站点使用的 HttpOnly Cookie。访问码只通过私密渠道发给获准使用的人，不要和公开链接一起发布。Mac 必须开机、联网且保持服务运行；睡眠期间无法访问。Cloudflare 只转发网页请求，访客的素材和导出帧不会上传到服务端编码。

临时网址由 Cloudflare Quick Tunnel 分配，服务重启或公网连接恢复后可能变化。共享 LaunchAgent 会在登录后自动启动，并由 `caffeinate` 防止电脑进入睡眠；隧道断线时会自动重连，本机 4173 服务也会持续复用或拉起。长期固定网址需要自己的域名和 Cloudflare Tunnel 账号：在 Cloudflare Zero Trust 创建命名隧道，添加公开主机名并把服务源站指向 `http://127.0.0.1:4173`；把该隧道令牌写入仅本机用户可读的 `.runtime/tunnel-token`，把 `https://你的域名` 写入 `.runtime/share-hostname`，再运行 `npm run share:restart`。启动器检测到令牌后自动切换到命名隧道，不需要改网页代码。继续保留应用访问码。不要直接把 4173 端口做公网端口映射。

## 管理命令

- `npm run share:status`：查看当前网址、状态和访问码文件位置。
- `npm run share:invite`：在本机终端显示当前网址和访问码，供你私下发给使用者。
- `npm run share:restart`：修改服务脚本后重启；临时网址可能变化。
- `npm run share:publish`：把当前本地 `public/` 发布为公网快照；公网正在运行时会直接读取新快照，不需要重启。
- `npm run share:sync`：`share:publish` 的同义命令。
- `npm run share:stop`：停止共享。重新登录 Mac 后服务会按 LaunchAgent 设置启动。
- `npm run share`：在终端前台运行，不安装开机服务。

修改 `public/` 里的网页后，新打开或刷新页面立即读取最新版；无需重新部署。已有用户的编辑状态保存在他们各自浏览器的当前页面内，刷新会丢失未导出的工作，不应在别人正在编辑时强制要求刷新。服务端修改则需 `share:restart`。

本地验证新功能使用 `npm run dev:local`，地址为 `http://127.0.0.1:4174/`。这个入口使用独立端口并关闭登录校验，仅适合本机开发；公网部署请通过 `PIXEL_SPRITE_ACCESS_KEY` 配置私有访问码。它与公网读取同一套 `public/` 代码。当前帧 PNG、全部动作帧 PNG、透明 PNG Sequence、透明 GIF 和透明 MOV 都在访问者浏览器本地生成，不依赖 Mac FFmpeg；透明 MOV 现在优先使用浏览器内的 FFmpeg WebAssembly 生成 ProRes 4444（首次点击会加载约 31 MB 编码器），导出的画布严格按精灵像素边界裁切，不保留额外透明边。

本地服务常驻使用 `npm run local:install`。它会安装 `~/Library/LaunchAgents/com.pixel-sprite-animator.local.plist`，在登录后自动启动 `4174` 服务，异常退出后自动拉起。`npm run local:status` 查看状态，`npm run local:restart` 重启，`npm run local:open` 打开本地网页，`npm run local:stop` 停止常驻服务。素材库目前仅在本地入口显示，最多保存 20 张精灵图，并可在动画剪辑区按图层管理。

本地动画剪辑区包含 Aseprite 风格的帧时间轴：帧编号横向排列、图层纵向排列，黄色边框是播放指针，白色边框是当前编辑帧。点击第 N 帧只切换编辑目标，不会移动播放指针；拖动帧排序也会保持播放位置。Sprite Sheet 编辑区的 `− / 100% / ＋ / ◎` 只改变素材查看倍率，不改变原始像素和框选坐标。

图层时间轴不再预置背景、固定装饰或动作帧占位层；只有实际加入的 Sprite Sheet 才会生成可编排图层。每个框选动作会先按非透明像素紧边裁切，再进入预览和 PNG 导出。

“基于当前图层新建动作”会创建第二条独立时间轴并自动选中；之后的“追加到当前动作”只追加到当前选中的时间轴。帧列表支持拖动框选或按住 Shift 多选，再用“删除所选帧”批量删除。

导出帧率与预览速度联动：导出帧率为 `FPS × 预览速度`，例如 `12 FPS + 0.5×` 导出为 `6 FPS`。导出持续倍率仍会额外重复帧，用于导出更慢的版本。

## 限制与安全

- 本地与公网访问码通过 `PIXEL_SPRITE_ACCESS_KEY` 配置；未配置时共享服务会生成随机访问码并写入 `.runtime/access-key`。多人共用一个访问码；如泄露，替换环境变量后重启并重新通知授权用户。
- 导出的 PNG、GIF、MOV 和 PNG Sequence 都使用当前动作的帧与运动设置，并以透明像素范围严格裁切；GIF/MOV/Sequence 的帧持续与循环设置来自导出面板。动画格式会自动选择整数像素倍率，目标画布至少约为 `800×900`，以提高 GIF 和视频清晰度。
- 浏览器选择的 Sprite Sheet、帧数据和导出视频不会提交到服务器；服务端不保存用户项目，也不运行视频编码器。
- 访问码仍用于保护工作台。公网只建议发给授权使用者；Cloudflare 仍会转发网页请求，但不会收到视频帧导出请求。
- 公网入口需要本机 `cloudflared` 保持隧道运行；这只提供网页访问，不参与访客导出计算。
