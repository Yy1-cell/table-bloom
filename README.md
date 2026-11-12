# Table & Bloom（饭局）PWA

多伦多华人／学生的“一起吃饭”应用。**网页应用（PWA）**：手机浏览器打开，可“添加到主屏幕”，像 App 一样使用，无需应用商店。

- 不配置后端 → **演示模式**（数据只存在本机浏览器，任意邮箱登录，验证码 `123456`，对方的回应是模拟的；新账号自带已加入／待回复／已结束的饭局，饭局里有“演示：跳到饭后”按钮，可体验上传照片和写饭后日记；资料页有“重置演示数据”）
- 配置 Supabase → **真实多人模式**（邮箱验证码登录，所有人共享同一份数据）

## 一、先在本地看一眼（1 分钟）

```bash
cd table-bloom-pwa
python3 -m http.server 8123
# 浏览器打开 http://localhost:8123
```
用任意邮箱登录，验证码 `123456`。（Service Worker 只在 localhost 或 https 下工作。）

## 二、接入 Supabase（真实多人，约 15 分钟，免费额度够用）

1. 在 <https://supabase.com> 新建项目（Region 选 `Canada (Central)`）。
2. **运行数据库脚本**：左侧 *SQL Editor* → New query → 粘贴 `supabase/schema.sql` 全部内容 → Run。可重复运行，不会重复建表。
3. （相册用）`schema.sql` 已自动创建私有存储桶 `table-photos` 和访问规则（只有同桌成员能看/传照片）。运行完请到 *Storage* 页面确认能看到这个桶。
3. （可选）再运行 `supabase/seed_samples.sql`，加 5 个“示例饭局”，让新用户第一次打开不是空的。
4. **开启邮箱验证码**：*Authentication → Providers → Email* 保持开启。
   *Authentication → Email Templates → Magic Link*，把正文改成同时显示验证码，例如：
   ```html
   <h2>Table & Bloom 登录</h2>
   <p>你的验证码：<strong>{{ .Token }}</strong></p>
   <p>或点击链接直接登录：<a href="{{ .ConfirmationURL }}">登录</a></p>
   ```
   （也把 *Confirm signup* 模板做同样修改，因为新用户走的是这个模板。）
5. **设置网址**：*Authentication → URL Configuration*：Site URL 填你最终的网站地址（如 `https://你的域名/`），Redirect URLs 也加上它（本地测试再加 `http://localhost:8123/`）。
6. **填写密钥**：*Project Settings → API*，把 *Project URL* 和 *anon public key* 填进 `config.js`：
   ```js
   window.TB_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",          // anon key 可以公开，安全靠数据库的行级权限（RLS）
     DEFAULT_CENTER: { lat: 43.6532, lng: -79.3832 },
     SUPPORT_EMAIL: "你的联系邮箱"          // 显示在“安全见面小提示”里，可留空
   };
   ```
   **千万不要**把 `service_role` key 放进来。
7. **访客登录（不用邮箱）**：*Authentication → Sign In / Providers* 里打开 **Allow anonymous sign-ins**。打开后登录页会有“不用邮箱，以访客身份进入”按钮，朋友不用收验证码就能进来（账号只存在那部手机/浏览器里，退出或清数据就找不回）。测试阶段这样最省事，不需要接发信服务。
8. 免费项目默认每小时只能发少量验证码邮件；而且 Supabase 现在要求先接自己的 SMTP 才能改邮件模板。正式给很多人用之前，在 *Authentication → SMTP Settings* 接一个自己的发信服务（Resend、Postmark 等）。

## 三、上线（静态网站，HTTPS 必须）

整个文件夹就是网站，没有构建步骤。任选其一：Netlify（拖拽文件夹）、Vercel、Cloudflare Pages、GitHub Pages。
上线后用手机打开：

- **iPhone（Safari）**：分享按钮 → 添加到主屏幕
- **安卓（Chrome）**：菜单 → 安装应用 / 添加到主屏幕

**更新版本时**：改完文件后，把 `sw.js` 第一行附近的 `CACHE_VERSION = "tb-v1"` 改成 `tb-v2`（依次递增）再部署，用户会看到“有新版本，刷新”的提示。

## 四、已内置的安全措施

所有写操作都经过数据库函数（`supabase/schema.sql`），服务器端校验，不依赖前端：
座位上限与自动满员/重开、申请制与直接加入、婉拒后不可重复申请、双向屏蔽、举报、爽约记录、每天最多发起 5 桌、同时最多 5 个待回复申请、被暂停账号不能操作、删除账号级联清除所有数据、日记仅本人可见，照片仅同桌成员可见（每桌最多 12 张，前端上传前会压缩）。
前端要求 18 岁以上确认，并提示在公共场所见面。

## 五、文件说明

| 路径 | 作用 |
|---|---|
| `index.html`、`css/style.css` | 页面外壳与样式 |
| `js/main.js` | 启动、路由、导航、Service Worker |
| `js/views/*.js` | 各页面：登录、发现、饭局详情、发起、我的、日记、资料 |
| `js/api-demo.js` / `js/api-supabase.js` | 两套数据层（接口一致），`js/api.js` 自动选择 |
| `js/strings.js` | 中英文文案（改文案在这里） |
| `js/geo.js` | 地点搜索（Photon/OpenStreetMap）、中点附近餐厅（Overpass） |
| `supabase/schema.sql`、`seed_samples.sql` | 数据库结构、权限、函数、示例数据 |
| `supabase/tests/test_schema.py` | 数据库规则测试（需本地 Postgres，80 项，含相册和存储权限） |
| `tools/e2e_demo.py`、`e2e_journey.py`、`e2e_map.py`、`e2e_offline.py`、`check_i18n.py` | 浏览器端到端测试、离线测试、文案完整性检查 |

## 六、地图与导航

- 底部「地图」标签：搜地点或用当前位置，列出附近的饭局和餐厅（餐厅数据来自 OpenStreetMap）。
- 每个地点都有按钮：**评分与评价**（打开谷歌地图的地点页，可看评分、评价、营业时间、照片）、**公交地铁／步行／驾车**路线。手机上会直接唤起谷歌地图 App，iPhone 另有 Apple 地图按钮。
- 饭局详情、发起饭局选好地点后、推荐餐厅列表里也有同样的按钮。
- 目前是“跳转到地图 App”的方式，不需要任何地图密钥，也不收费。要在应用内直接显示谷歌评分，需要申请 Google Places API Key（按调用量计费），之后可以再加。

## 七、已知限制

- 地图搜索用的是免费公共服务（Photon / Overpass），适合小规模；用户多了需换成自己的地图服务（Google Places、高德以外的海外服务等）。
- 删除账号时数据库里的照片记录会清掉，但存储桶里的图片文件需要定期手动清理（Storage 页面）。
- 没有站内推送：目前是打开应用时提示“申请通过了”。要做推送需要 Web Push（iPhone 需先安装到主屏幕），或之后做成微信小程序的订阅消息。
- 没有后台管理界面：举报在 Supabase 的 `reports` 表里查看；封禁用户把 `profiles.status` 改成 `suspended`。
- **真实 Supabase 模式我在这里无法联网实测**：数据库脚本已用本地 Postgres 测过，演示模式已用浏览器完整测过，但“前端 ↔ 你的 Supabase 项目”这一步请你配置后跑一遍（登录 → 发起 → 另一个账号加入）。
