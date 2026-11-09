export interface ShareHolder {
  name: string;
  sharesHeld: number;
}

export interface UnlockGroups<T> {
  groups: T[][];
  truncated: boolean;
}

export function minimalUnlockGroups<T extends ShareHolder>(
  holders: T[],
  threshold = 3,
  limit = 50,
): UnlockGroups<T> {
  const groups: T[][] = [];
  const isSuperset = (candidate: T[]) =>
    groups.some((g) => g.every((member) => candidate.includes(member)));

  for (let size = 1; size <= threshold; size++) {
    const found: T[][] = [];
    const walk = (start: number, current: T[]): boolean => {
      if (groups.length + found.length >= limit) return false;
      if (current.length === size) {
        const total = current.reduce((s, h) => s + h.sharesHeld, 0);
        if (total >= threshold && !isSuperset(current)) found.push([...current]);
        return true;
      }
      for (let i = start; i < holders.length; i++) {
        current.push(holders[i]);
        const keepGoing = walk(i + 1, current);
        current.pop();
        if (!keepGoing) return false;
      }
      return true;
    };
    const completed = walk(0, []);
    groups.push(...found);
    if (!completed) return { groups, truncated: true };
  }
  return { groups, truncated: false };
}
