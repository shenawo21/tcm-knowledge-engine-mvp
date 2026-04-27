import { useEffect, useState } from 'react';
import { getEntityDetail, listEntities } from '../lib/api';
import type { EntityDetail, EntityListItem } from '../lib/types';

export function KnowledgePage() {
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listEntities()
      .then(rows => {
        if (cancelled) return;
        setEntities(rows);
        setError(null);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    getEntityDetail(selectedId)
      .then(d => {
        if (!cancelled) setDetail(d);
      })
      .catch(e => {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <section>
      <h1>知识库</h1>

      <div className="panel">
        {loading && <p>加载中...</p>}
        {error && <p style={{ color: 'crimson' }}>读取失败：{error}</p>}
        {!loading && !error && entities.length === 0 && (
          <p>暂无实体。先到「采集任务」页输入一段文本并运行 AI 结构化。</p>
        )}
        {entities.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>关系数</th>
                <th>来源数</th>
              </tr>
            </thead>
            <tbody>
              {entities.map(e => (
                <tr
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  style={{
                    cursor: 'pointer',
                    fontWeight: selectedId === e.id ? 'bold' : 'normal',
                  }}
                >
                  <td>{e.name}</td>
                  <td>{e.entityType}</td>
                  <td>{e.relationsCount}</td>
                  <td>{e.sourceCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        {!selectedId && <p>选择上表中的一行查看详情。</p>}
        {detailError && <p style={{ color: 'crimson' }}>读取详情失败：{detailError}</p>}
        {selectedId && !detail && !detailError && <p>加载详情中...</p>}
        {detail && (
          <>
            <h2>{detail.entity.name}</h2>
            <p>
              <b>类型：</b>
              {detail.entity.entityType}
            </p>
            {detail.entity.description && (
              <p>
                <b>描述：</b>
                {detail.entity.description}
              </p>
            )}
            {detail.entity.tcmExplanation && (
              <p>
                <b>中医解释：</b>
                {detail.entity.tcmExplanation}
              </p>
            )}
            {detail.entity.westernExplanation && (
              <p>
                <b>中西对照：</b>
                {detail.entity.westernExplanation}
              </p>
            )}
            <p>
              <b>来源数：</b>
              {detail.entity.sourceCount}
            </p>

            <h3>出向关系</h3>
            {detail.outgoing.length === 0 ? (
              <p>无</p>
            ) : (
              <ul>
                {detail.outgoing.map(r => (
                  <li key={r.id}>
                    {r.fromName} —[{r.relationType}]→ {r.toName}
                  </li>
                ))}
              </ul>
            )}

            <h3>入向关系</h3>
            {detail.incoming.length === 0 ? (
              <p>无</p>
            ) : (
              <ul>
                {detail.incoming.map(r => (
                  <li key={r.id}>
                    {r.fromName} —[{r.relationType}]→ {r.toName}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
