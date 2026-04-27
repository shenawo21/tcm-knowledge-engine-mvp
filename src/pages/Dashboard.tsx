export function Dashboard() {
  return (
    <section>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="card"><b>今日新增实体</b><span>45</span></div>
        <div className="card"><b>今日新增关系</b><span>102</span></div>
        <div className="card"><b>待审核资料</b><span>5</span></div>
        <div className="card"><b>待复习卡片</b><span>25</span></div>
      </div>

      <div className="panel">
        <h2>最近学习路径</h2>
        <p>脾虚湿困 → 健脾化湿 → 参苓白术散 → 白术 / 茯苓 / 薏苡仁</p>
      </div>
    </section>
  );
}
