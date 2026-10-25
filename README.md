# 麦当劳点餐 × 后厨实时动画

一个把点餐过程变成可视化后厨体验的实验项目：右边选餐、调整购物车，左边看餐品逐步制作；也可以找店员「小麦」聊聊，或在汉堡工坊里亲手组合配料。

项目使用 Python + FastAPI 提供服务，前端使用原生 HTML、CSS 和 JavaScript，通过麦当劳 MCP 获取门店、菜单与算价结果，通过支持工具调用的 OpenAI 兼容接口提供 AI 点餐对话。

> 默认开启演示模式，可以浏览菜单和算价，服务端会拒绝真实下单。后厨动画是视觉演示，不代表餐厅的实际制作进度。当前内置门店与汉堡配方数据主要面向长春。

## 可以做什么

- **点餐与后厨动画联动**：选择餐品后，观看后厨角色和制作流程，直观了解订单的处理过程。
- **门店与真实菜单**：选择长春门店，读取对应菜单和价格；自动选店会参考营业时间，并尝试可用门店。
- **AI 店员「小麦」**：用自然语言表达预算、口味和点餐需求，让助手检索餐品、查询营养信息、调整购物车并算价。点击入口或按 `F` 打开对话。
- **汉堡工坊**：组合配料，查看与真实汉堡配方的匹配情况，将符合条件的餐品加入购物车。
- **结算与订单管理**：算价后核对餐品、门店、金额和取餐方式；开启真实模式后，可确认下单、打开官方支付页面、刷新状态或申请取消订单。

餐品可售情况和最终金额以麦当劳接口返回为准。部分动画素材是近似呈现，不能作为配料或营养信息的依据。

## 快速开始

### Windows 一键启动

准备 **Python 3.10 或更高版本**，安装时勾选「Add python.exe to PATH」。首次安装依赖需要联网。

```powershell
git clone https://github.com/Daxcq/1024mcdonalds.git
cd 1024mcdonalds
.\start.bat
```

也可以下载仓库后，双击根目录的 `start.bat`。

启动脚本会自动创建 `.venv`、安装依赖，并在缺少 `.env` 时从 `.env.example` 生成配置文件。按提示填好配置后重新启动；服务就绪后会自动打开浏览器。

- 点餐与后厨首页：<http://127.0.0.1:8000/>
- 汉堡工坊：<http://127.0.0.1:8000/workshop>

关闭启动窗口或按 `Ctrl+C` 停止服务。

### 手动启动

以下命令在 Windows PowerShell 中执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

编辑 `.env`，填入自己的配置，再运行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.server:app --host 127.0.0.1 --port 8000
```

如果已经有 `.env`，保留现有文件即可。项目不需要安装 Node.js 或执行前端构建；Node.js 仅用于可选的前端逻辑测试。

## 环境配置

配置模板见 [`.env.example`](.env.example)。下面的 token 和 key 都是占位符，需要替换为自己的凭据：

```dotenv
MCD_MCP_URL=https://mcp.mcd.cn
MCD_MCP_TOKEN=your_mcd_mcp_token

LLM_API_KEY=your_llm_api_key
LLM_BASE_URL=https://api.stepfun.com/v1
LLM_MODEL=step-3.7-flash

DEMO_MODE=1
```

- `MCD_MCP_URL`、`MCD_MCP_TOKEN`：用于连接麦当劳 MCP。读取真实菜单、算价和订单操作需要有效配置及可用的上游服务。
- `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`：用于「小麦」对话。仓库模板提供阶跃星辰的配置示例；换用其他服务时，需要选择兼容 Chat Completions 且支持工具调用的模型。缺少这组配置时，对话功能不可用，手动点餐入口仍可使用。
- `LLM_REASONING_EFFORT`：可选，传给支持该参数的模型；可用值取决于模型服务。
- `DEMO_MODE`：默认为 `1`。只有显式设置为 `0` 并重启服务，才允许真实下单。

`.env` 已被 Git 忽略，不要把实际 token 或 API key 写进源码或提交到仓库。

## 体验流程

1. 打开首页，选择门店，或由页面尝试自动选店。
2. 在菜单中选择餐品，观看后厨动画；也可以与「小麦」对话点餐。
3. 进入 `/workshop` 体验配料组合，并将匹配的汉堡加入购物车。
4. 点击结算或算价，查看接口返回的实际金额与可选取餐方式。
5. 演示模式到算价为止。真实模式下，核对信息后点击「确认下单」，再到官方支付页面完成支付。

### 真实下单说明

开启真实模式后，订单会使用 `MCD_MCP_TOKEN` 对应的真实麦当劳账号创建，可能产生实际费用。AI 助手不直接创建订单，仍需在页面确认。

支付由用户在麦当劳官方页面完成。若接口没有返回支付链接，或创建请求超时、结果不明确，请到麦当劳 App 核实订单，再决定下一步操作。

订单保存在服务端内存会话中，同一浏览器标签页刷新可以尝试恢复；会话过期或服务重启后，请到麦当劳 App 查看真实订单。页面支持查询状态与提交取消请求，最终结果以官方返回为准。

服务默认只监听 `127.0.0.1`，当前没有用户登录和账号隔离，适合本机运行。不要直接作为多人共享的公网点餐服务部署。

## 项目结构

```text
app/                  FastAPI 服务、AI 点餐、MCP 客户端、购物车和订单逻辑
  burger/             汉堡配方匹配与工坊逻辑
assets/               后厨场景、角色、餐品素材和样式
js/                   前端动画引擎、菜单、对话及订单界面
static/               汉堡工坊等页面
index.html            点餐与后厨动画首页
data/                 长春门店、汉堡数据及配方补充
scripts/              启动、自检、门店数据采集与素材处理脚本
tests/                Python 测试
tools/                前端逻辑测试与素材处理工具
output/               素材生成结果及预览
start.bat             Windows 一键启动入口
requirements.txt      服务运行依赖
requirements-dev.txt  生图与切图脚本的额外依赖
```

## 开发与检查

在项目根目录运行环境自检：

```powershell
.\.venv\Scripts\python.exe scripts\doctor.py
```

运行 Python 单元测试：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

安装 Node.js 后，可运行前端动画引擎逻辑测试：

```powershell
node tools/logic_test.js
```

只有需要使用生图、切图脚本时，才需要安装额外依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

## 常见问题

- **端口 8000 被占用**：关闭之前的服务窗口，或运行 `.\start.bat --port 8001`。
- **不希望自动打开浏览器**：运行 `.\start.bat --no-browser`。
- **依赖安装失败**：检查网络，或运行 `.\.venv\Scripts\python.exe -m pip install -r requirements.txt -i https://pypi.org/simple` 后重试。
- **页面能打开，但菜单或算价失败**：检查 MCP 配置、token 是否有效，以及门店是否可用；查看启动窗口中的错误提示。
- **「小麦」无法聊天**：检查三项 `LLM_*` 配置、模型是否支持工具调用，以及模型服务是否可访问。
- **更换城市**：当前首页门店列表与汉堡配方使用内置长春数据，需要补充对应城市的数据并调整加载逻辑。

更详细的启动参数与订单操作说明见 [启动说明](启动说明.md)。
