# TcpSwift 论文插图说明

本文档对 `docs/plots` 目录下生成的插图进行逐图说明。所有图像均由带 `// @ts-check` 与 JSDoc 类型标注的 `docs/plots/main.js` 从 `logs/` 归档 FlowMonitor XML 自动生成，可用于论文中的数据核查、方法说明和系统机制展示。

## 图像生成与数据来源

绘图脚本会遍历 `logs/` 下的全部 FlowMonitor 文件并解析：

- `logs/comparison/*.flowmonitor`：纯 TCP 设置（`enable_udp_burst=false`）。
- `logs/comparison-udp/*.flowmonitor`：UDP Burst 设置（突发平均负载 = 瓶颈速率 32%、峰值 64%、50% 占空比、1024 B 报文）。
- 全部指标仅在**前向数据流**（10.1.x → 10.2.x）上定义；聚合 goodput 使用所有前向流的总接收字节除以最早发送至最晚接收的共同观测区间。导出结果写入 `logs/summary/kpi_forward.csv`（完整归档为 288 条记录）。
- 详细展开场景为表 S1--S19（共 19 个纯 TCP 场景；其中 15 个具有 UDP 配对场景），与论文/学位论文中的场景编号一致；其余 17 个补充场景保留在 `kpi_forward.csv` 中供检索。
- `logs/` 是迁移前保留的归档数据集；原生 C++ TcpSwift 的新实验统一写入 `logs/real/`，由根目录 `main.js` 处理。引用实验结论前应先完成真实重复实验与来源核验。

当前批量生成 6 组图像（`fig01_goodput_clean`、`fig02_delay_clean`、`fig03_tradeoff_clean`、`fig04_udp_burst_clean`、`fig06_architecture_zh`、`fig07_workflow_zh`），每组同时提供 `.png`、`.pdf` 和 `.svg` 三种格式：PNG/SVG 由无头 Chromium 中的 `Plotly.toImage` 导出，PDF 由 `page.pdf()` 输出为矢量页面。

## 批量更新方法

在仓库根目录执行：

```bash
pnpm install
pnpm exec playwright install chromium
node docs/plots/main.js
```

执行后脚本会重新读取 `logs/`，重算 `logs/summary/kpi_forward.csv`，仅更新本流水线拥有的 6 组 `png/pdf/svg`，并刷新 `docs/plots/figure_manifest.json`。原生实验在 `logs/real/plots*` 下的批量对比图（吞吐/时延/丢包/雷达图等）由根目录的 `node main.js draw` 生成。

## fig01_goodput_clean —— 代表性场景聚合吞吐量

19 个代表性场景（S1--S19）纯 TCP 设置的聚合前向吞吐量，对数纵轴同时呈现百兆至万兆以上链路。该图用于检查归档数据的吞吐量分布；正式结论应以 `logs/real/` 中完成多随机种子复现实验后的结果为准。

## fig02_delay_clean —— 平均单向时延与基线传播时延

19 个代表性场景的平均单向前向时延（对数坐标），黑色短划线为基线传播时延（BaseOWD = 2 × 接入时延 + 瓶颈时延）。在 RED/ECN 配置下四协议时延同量级、均贴近基线上方；柱顶与短划线的距离为排队分量。

## fig03_tradeoff_clean —— 利用率-时延权衡

纯 TCP 设置 19 个场景的瓶颈利用率—平均单向时延散点（时延对数坐标）。用于回应"吞吐提升是否以时延/丢包为代价"的疑问。

## fig04_udp_burst_clean —— 跨流量鲁棒性

15 个配对场景在 UDP Burst（平均 32% / 峰值 64% 瓶颈速率、50% 占空比）下相对纯 TCP 设置的吞吐量变化（上）与新增丢包（下，符号对数坐标）。该图用于核查配对计算与展示方式，不替代原生 C++ 实现上的多随机种子复现实验。

## fig06_architecture_zh —— 系统架构（方法/系统框图）

Swift 原生 C++ 控制回路总体架构：协议栈五类回调直接读取每连接状态，在同一 ns-3 离散事件进程内完成拥塞三分类、两级 BDP 估计、α 自适应与窗口安全控制，并写回 `ssThresh`/`cWnd`；运行时不依赖 Python、OpenGym、ZeroMQ 或 Protobuf。

## fig07_workflow_zh —— 方法流程图

拥塞控制方法整体流程（状态获取 → 拥塞判定 → 参数自适应 → 目标窗口逼近 → 差异化缩减与安全保护 → 决策应用）。图中不出现具体算法品牌名与实验数值，直接用于发明专利的方法实施例与摘要附图。

## 术语约定与使用注意

- 上述方法图使用“状态读取—本地决策—原生写回”的确定性控制表述；性能反馈值仅驱动控制参数相对自身慢速基线的在线微调，不涉及训练或模型推理。
- 论文正文引用实验数值时，应以经过来源核验的 `logs/real/summary/` 结果为准；`logs/summary/kpi_forward.csv` 仅对应迁移前归档数据。
- 专利正文不建议直接暴露具体实验数值与协议品牌名；如需使用本组图像，应另行核对模块命名是否符合专利撰写要求。
- 后续原生仿真数据更新后，应执行 `node main.js draw` 与 `node main.js summary`；归档论文图需要刷新时执行 `node docs/plots/main.js`。
- LaTeX 文档优先引用 `.pdf`；Word 文档优先插入 `.png`；需二次编辑时使用 `.svg`。
