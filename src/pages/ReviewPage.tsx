export function ReviewPage() {
  return (
    <section>
      <h1>AI审核</h1>
      <div className="panel">
        <h2>待审核项目</h2>
        <table>
          <thead>
            <tr><th>标题</th><th>类型</th><th>等级</th><th>决策</th></tr>
          </thead>
          <tbody>
            <tr><td>桂枝汤条目</td><td>方剂</td><td>A</td><td>直接入库</td></tr>
            <tr><td>网络医案：腰腿痛</td><td>医案</td><td>C</td><td>暂存参考</td></tr>
            <tr><td>附子经验文</td><td>药物</td><td>B</td><td>标注风险后入库</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
