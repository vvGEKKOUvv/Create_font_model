/** Exact original-name suggestions only. Duplicate names on either side remain manual. */
export function matchSourceOriginalNames(existing, incoming) {
  const group = (entries) => {
    const names = new Map();
    entries.forEach((entry, index) => {
      const name = entry.sourceOriginalName;
      if (typeof name !== 'string' || !name.trim()) return;
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(index);
    });
    return names;
  };
  const oldNames=group(existing),newNames=group(incoming),matches=[],ambiguousNames=[];
  for(const [name,oldIndices] of oldNames) {
    const newIndices=newNames.get(name);if(!newIndices)continue;
    if(oldIndices.length!==1||newIndices.length!==1){ambiguousNames.push(name);continue;}
    matches.push({objectId:existing[oldIndices[0]].id,incomingIndex:newIndices[0]});
  }
  return {matches,ambiguousNames};
}
