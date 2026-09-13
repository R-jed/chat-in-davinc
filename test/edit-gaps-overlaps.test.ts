import { describe, expect, it } from 'vitest';
import type { EditStructureInspect } from '../src/shared/types.js';
import { deriveEditGapsOverlaps } from '../src/main/workflow.js';

function structure(items: EditStructureInspect['tracks'][number]['items']): EditStructureInspect {
  return {
    readerId: 'edit.structure_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Fixture', startFrame: 0, endFrame: 40 },
    tracksObserved: 1,
    itemsObserved: items.length,
    tracksTruncated: false,
    itemsTruncated: false,
    methodEvidence: {
      strategy: 'dir',
      checkedMethods: ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration', 'GetLeftOffset', 'GetRightOffset', 'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'],
      fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration', 'GetLeftOffset', 'GetRightOffset', 'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'],
      missingMethods: [],
      failedMethods: [],
      itemsProbed: items.length
    },
    tracks: [{ type: 'video', index: 1, name: 'V1', enabled: true, locked: false, items }],
    unverified: ['recordRangeBoundarySemantics', 'sourceRangeBoundarySemantics', 'transitionState', 'linkedAudioRelationships']
  };
}

function item(id: string, start: number | null, end: number | null): EditStructureInspect['tracks'][number]['items'][number] {
  return {
    id,
    name: id,
    recordStart: start,
    recordEnd: end,
    duration: start === null || end === null ? null : end - start,
    sourceStart: null,
    sourceEnd: null,
    leftOffset: null,
    rightOffset: null,
    mediaPoolItemId: null,
    recordRangeConsistent: start === null || end === null ? null : true
  };
}

describe('edit gaps/overlaps derivation', () => {
  it('reports only boundary-semantics-independent gap/overlap relations and keeps delta 0/1 ambiguous', () => {
    const result = deriveEditGapsOverlaps(structure([
      item('A', 0, 10),
      item('B', 5, 12),
      item('C', 13, 20),
      item('D', 23, 30)
    ]));

    expect(result.relationships.map(({ kind, boundaryDelta }) => ({ kind, boundaryDelta }))).toEqual([
      { kind: 'overlap', boundaryDelta: -5 },
      { kind: 'boundary_ambiguous', boundaryDelta: 1 },
      { kind: 'gap', boundaryDelta: 3 }
    ]);
    expect(result).toMatchObject({
      gapCountObserved: 1,
      overlapCountObserved: 1,
      boundaryAmbiguousCountObserved: 1,
      comparablePairsObserved: 3,
      complete: true
    });
    expect(result.unverified).toContain('recordRangeBoundarySemantics');
    expect(result.unverified).toContain('ambiguousBoundaryClassification');
  });

  it('does not compare through a track when any record boundary is unavailable', () => {
    const result = deriveEditGapsOverlaps(structure([item('A', 0, 10), item('B', null, null), item('C', 20, 30)]));
    expect(result.relationships).toEqual([]);
    expect(result.unverifiedTrackCount).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.unverified).toContain('incompleteRecordRanges');
  });
});
