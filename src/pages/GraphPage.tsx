export function GraphPage() {
  return (
    <section>
      <h1>知识图谱</h1>
      <div className="graph">
        <div className="node center">桂枝汤</div>
        <div className="node n1">营卫不和</div>
        <div className="node n2">恶风</div>
        <div className="node n3">汗出</div>
        <div className="node n4">桂枝</div>
        <div className="node n5">芍药</div>
      </div>
      <p className="hint">MVP使用静态图谱占位，后续接入 React Flow 或 Cytoscape.js。</p>
    </section>
  );
}
