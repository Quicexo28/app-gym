import {
  computeExerciseEntrySearchScore,
  getMuscleGroupOrderIndex,
  type ExerciseCatalogEntry,
} from "./exerciseCatalog";

// Arbol de ejercicios por categoria, compartido por Ejercicios, Rutinas y Cargas.

type MutableNode = {
  label: string;
  path: string[];
  children: Map<string, MutableNode>;
  items: TreeItem[];
};

export type CatalogNode = {
  label: string;
  path: string[];
  children: CatalogNode[];
  items: TreeItem[];
  totalItems: number;
  maxScore: number;
};

export type TreeItem = {
  entry: ExerciseCatalogEntry;
  treePath: string[];
  matchScore: number;
};

export function formatExerciseNameForList(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

export function formatExercisePathForList(path: string[]): string {
  return path.map((segment) => formatExerciseNameForList(segment)).join(" - ");
}

export function toTreeItems(entries: ExerciseCatalogEntry[], searchTokens: string[]): TreeItem[] {
  return entries.map((entry) => {
    const matchScore = searchTokens.length > 0 ? computeExerciseEntrySearchScore(entry, searchTokens) : 0;
    return { entry, treePath: entry.path, matchScore };
  });
}

function freezeNodes(source: Map<string, MutableNode>, rankBySimilarity: boolean, orderRootByMuscleGroup = false): CatalogNode[] {
  const nodes = Array.from(source.values()).map((node) => {
    const children = freezeNodes(node.children, rankBySimilarity, orderRootByMuscleGroup);
    const items = [...node.items].sort((a, b) => {
      if (rankBySimilarity && b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return a.entry.name.localeCompare(b.entry.name);
    });
    const childCount = children.reduce((acc, child) => acc + child.totalItems, 0);
    const itemMaxScore = items.reduce((maxScore, item) => Math.max(maxScore, item.matchScore), 0);
    const childMaxScore = children.reduce((maxScore, child) => Math.max(maxScore, child.maxScore), 0);

    return {
      label: node.label,
      path: node.path,
      children,
      items,
      totalItems: items.length + childCount,
      maxScore: Math.max(itemMaxScore, childMaxScore),
    };
  });

  const isRootLevel = orderRootByMuscleGroup && nodes.length > 0 && nodes[0].path.length === 1;

  nodes.sort((a, b) => {
    if (rankBySimilarity && b.maxScore !== a.maxScore) {
      return b.maxScore - a.maxScore;
    }
    if (isRootLevel) {
      const orderDiff = getMuscleGroupOrderIndex(a.label) - getMuscleGroupOrderIndex(b.label);
      if (orderDiff !== 0) return orderDiff;
    }
    return a.label.localeCompare(b.label);
  });

  return nodes;
}

export function buildTree(items: TreeItem[], rankBySimilarity: boolean, orderRootByMuscleGroup = false): CatalogNode[] {
  const root = new Map<string, MutableNode>();

  for (const item of items) {
    const path = item.treePath;
    if (path.length === 0) continue;

    let cursor = root;
    const currentPath: string[] = [];
    let currentNode: MutableNode | null = null;

    for (const segment of path) {
      currentPath.push(segment);
      let node = cursor.get(segment);
      if (!node) {
        node = { label: segment, path: [...currentPath], children: new Map<string, MutableNode>(), items: [] };
        cursor.set(segment, node);
      }
      currentNode = node;
      cursor = node.children;
    }

    if (currentNode) currentNode.items.push(item);
  }

  return freezeNodes(root, rankBySimilarity, orderRootByMuscleGroup);
}
