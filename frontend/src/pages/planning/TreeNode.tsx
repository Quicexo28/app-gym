import type { PlanningTemplateTree } from "../../api";
import { levelLabel, statusLabel } from "../../lib/planning/builders";

export default function TreeNode({ node }: { node: PlanningTemplateTree }) {
  return (
    <details className="treeNode" open>
      <summary className="treeSummary">
        <span>{`${node.name} (${levelLabel(node.level)})`}</span>
        <span className="chip">{statusLabel(node.status)}</span>
      </summary>
      <div className="treeChildren">
        {node.blocks && node.blocks.length > 0 ? (
          <div className="treeLeafList">
            {node.blocks.map((block, idx) => (
              <article key={`${node.id}_block_${idx}`} className="treeLeaf">
                <div>
                  <strong>{block.title}</strong>
                  <div className="small">{`Sesión ${block.relative_day}`}</div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {node.children && node.children.length > 0 ? (
          <div className="treeList">
            {node.children.map((child) => (
              <TreeNode key={child.id} node={child} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
