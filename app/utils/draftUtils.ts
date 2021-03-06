import { SelectionState, ContentBlock, Entity, Modifier, EditorState, CharacterMetadata, ContentState } from 'draft-js';
import { DecoratorStrategyCallback } from 'draft-js-plugins-editor';
import { constant, sum } from 'lodash';
import { Map, Set, OrderedSet, Iterable, List } from 'immutable';

// Can be replaced with ReturnType<T> in TS 2.8
if (false as true) var _ = Entity.mergeData('', {});
export type EntityInstance = typeof _;
if (false as true) var __ = (null as any as EditorState).getLastChangeType();
export type EditorChangeType = typeof __;

export interface Range {
  readonly blockKey: string;
  readonly start: number;
  readonly end: number;
  equals(range: Range): boolean;
  hashCode(): number;
  inspect?(): string;
};

const Range = (blockKey: string, start: number, end: number): Range => ({
  blockKey,
  start,
  end,
  equals: (range: Range) => range.blockKey === blockKey && range.start === start && range.end === end,
  hashCode: () => parseInt(blockKey, 64) + start + end,
  inspect: () => `Range { ${blockKey}, ${start}, ${end} }`
});

export const createSelectionWithRange = (blockOrKey: ContentBlock | string, start: number, end: number): SelectionState => {
  const blockKey = typeof blockOrKey === 'string' ? blockOrKey : blockOrKey.getKey();
  return SelectionState.createEmpty(blockKey).merge({ anchorOffset: start, focusOffset: end }) as SelectionState
};

export const createSelectionWithSelection = (selectionState: SelectionState, moveAnchor: number, moveFocus: number): SelectionState => {
  return selectionState.merge({
    anchorOffset: selectionState.getAnchorOffset() + moveAnchor,
    focusOffset: selectionState.getFocusOffset() + moveFocus
  }) as SelectionState;
};

export const createSelectionWithBlock = (block: ContentBlock): SelectionState => (
  SelectionState.createEmpty(block.getKey()).merge({ focusOffset: block.getLength() }) as SelectionState
);

// https://github.com/facebook/draft-js/issues/1700
export const hasEdgeWithin = (selectionState: SelectionState, blockKey: string, start: number, end: number): boolean => {
  if (selectionState.getFocusKey() !== selectionState.getAnchorKey()) {
    return selectionState.hasEdgeWithin(blockKey, start, end);
  }

  if (selectionState.getFocusKey() !== blockKey) {
    return false;
  }

  const focusOffset = selectionState.getFocusOffset();
  const anchorOffset = selectionState.getAnchorOffset();
  return focusOffset >= start && focusOffset <= end || anchorOffset >= start && anchorOffset <= end;
};

export const stripEntitiesFromBlock = (contentState: ContentState, blockOrKey: ContentBlock | string, entityFilter: (entity: EntityInstance) => boolean): ContentState => {
  const block = typeof blockOrKey === 'string' ? contentState.getBlockForKey(blockOrKey): blockOrKey;
  let newContentState = contentState;
  block.findEntityRanges(value => {
    const entityKey = value.getEntity();
    const entity = entityKey && contentState.getEntity(entityKey);
    return entity && entityFilter(entity) || false;
  }, (start, end) => {
    const entitySelection = createSelectionWithRange(block, start, end);
    newContentState = Modifier.applyEntity(newContentState, entitySelection, null);
  });

  return newContentState;
};

export const stripStylesFromBlock = (contentState: ContentState, blockOrKey: ContentBlock | string, styleFilter: (styleName: string) => boolean, start: number = 0, end?: number): ContentState => {
  if (start === end) {
    return contentState;
  }
  const block = typeof blockOrKey === 'string' ? contentState.getBlockForKey(blockOrKey): blockOrKey;
  const originalCharacters = block.getCharacterList()
  const newCharacters = originalCharacters.slice(start, end).map(character => {
    return character!.getStyle().reduce((char, style) => {
      return styleFilter(style!) ? CharacterMetadata.removeStyle(char!, style!) : char!;
    }, character!);
  });

  const newBlock = block.set('characterList', originalCharacters.slice(0, start).concat(newCharacters).concat(originalCharacters.slice(end || originalCharacters.size + 1))) as ContentBlock;
  return contentState.setIn(['blockMap', block.getKey()], newBlock) as ContentState;
};

export const createDecoratorStrategyMatchingEntityType = (type: string) => (contentBlock: ContentBlock, callback: DecoratorStrategyCallback, contentState: ContentState): void => {
  contentBlock.findEntityRanges(character => {
    const entityKey = character.getEntity();
    return entityKey && contentState.getEntity(entityKey).getType() === type || false;
  }, callback);
};

export const forEachBlockInSelection = (editorState: EditorState, callback: (block: ContentBlock, start: number, end: number) => void): void => {
  const selection = editorState.getSelection();
  const contentState = editorState.getCurrentContent();
  const startKey = selection.getStartKey();
  const endKey = selection.getEndKey();
  let block = contentState.getBlockForKey(startKey);
  let blockKey = block.getKey();
  do {
    callback(
      block,
      blockKey === startKey ? selection.getStartOffset() : 0,
      blockKey === endKey ? selection.getEndOffset() : block.getLength()
    );
  } while (blockKey !== endKey && (() => {
    block = contentState.getBlockAfter(blockKey);
    return blockKey = block.getKey();
  })());
}

export const mapBlocksInSelection = <T>(editorState: EditorState, callback: (block: ContentBlock, start: number, end: number) => T): T[] => {
  const arr: T[] = [];
  forEachBlockInSelection(editorState, (block, start, end) => arr.push(callback(block, start, end)));
  return arr;
}

export const getTextFromSelection = (editorState: EditorState, blockDelimiter = '\n'): [string, Iterable<number, CharacterMetadata>] => {
  const text: string[] = [];
  let characters: Iterable<number, CharacterMetadata> = List<CharacterMetadata>();
  forEachBlockInSelection(editorState, (block, start, end) => {
    text.push(block.getText().slice(start, end));
    characters = characters.concat(block.getCharacterList().slice(start, end));
  });

  return [text.join(blockDelimiter), characters];
}

export const getInsertedCharactersFromChange = (changeType: EditorChangeType, oldEditorState: EditorState, newEditorState: EditorState): string => {
  if (changeType === 'insert-characters') {
    const oldSelection = oldEditorState.getSelection();
    const newSelection = newEditorState.getSelection();
    return newEditorState
      .getCurrentContent()
      .getBlockForKey(newSelection.getStartKey())
      .getText()
      .slice(oldSelection.getStartOffset(), newSelection.getEndOffset());
  }

  return '';
};

export const getDeletedCharactersFromChange = (changeType: EditorChangeType, oldEditorState: EditorState, newEditorState: EditorState): [string, Iterable<number, CharacterMetadata>] => {
  // backspace-character, remove-range:
  //   single block, collapsed or expanded selection (collapsed for backspace)
  //   collapsed: slice old block text from old selection start to new selection start
  //   not collapsed: deleted characters are the entirety of the old selected text
  //
  // delete-character:
  //   single block, collapsed constant selection
  //   slice old block text from selection start to selection start + 1
  //
  // split-block, and insert-characters with non-collapsed selection
  //   1+ blocks, non-collapsed selection
  //   deleted characters are the entirety of the old selected text
  //
  const oldSelection = oldEditorState.getSelection();
  if (changeType === 'backspace-character' || changeType === 'remove-range') {
    const block = oldEditorState.getCurrentContent().getBlockForKey(oldSelection.getStartKey());
    if (!oldSelection.isCollapsed()) {
      return getTextFromSelection(oldEditorState);
    }
    const deletedCharacterRange = [newEditorState.getSelection().getStartOffset(), oldSelection.getStartOffset()];
    return [block.getText().slice(...deletedCharacterRange), block.getCharacterList().slice(...deletedCharacterRange)];
  } else if (changeType === 'delete-character') {
    const block = oldEditorState.getCurrentContent().getBlockForKey(oldSelection.getStartKey());
    const selectionOffset = oldSelection.getStartOffset();
    const deletedCharacterRange = [selectionOffset, selectionOffset + 1];
    return [block.getText().slice(...deletedCharacterRange), block.getCharacterList().slice(...deletedCharacterRange)];
  } else if (!oldSelection.isCollapsed() && (changeType === 'insert-characters' || changeType === 'split-block')) {
    return getTextFromSelection(oldEditorState);
  }

  return ['', List<CharacterMetadata>()];
};

export const getAdjacentCharacters = (contentState: ContentState, selectionState: SelectionState): [string, string] => {
  const focusOffset = selectionState.getFocusOffset();
  const text = contentState.getBlockForKey(selectionState.getFocusKey()).getText();
  return [
    text.slice(focusOffset - 1, focusOffset),
    text.slice(focusOffset, focusOffset + 1)
  ];
};

export const performUnUndoableEdits = (editorState: EditorState, performEdits: (disabledUndoEditorState: EditorState) => EditorState): EditorState => {
  const disabledUndoEditorState = EditorState.set(editorState, { allowUndo: false });
  return EditorState.set(performEdits(disabledUndoEditorState), { allowUndo: true });
};

export function getContiguousStyleRange(block: ContentBlock, styleKey: string, aroundIndex: number): Range
export function getContiguousStyleRange(block: ContentBlock, characterFilter: (char: CharacterMetadata) => boolean, aroundIndex: number): Range
export function getContiguousStyleRange(block: ContentBlock, characterFilter: string | ((char: CharacterMetadata) => boolean), aroundIndex: number): Range {
  const filter = typeof characterFilter === 'string' ? (char: CharacterMetadata) => char.hasStyle(characterFilter) : characterFilter;
  const characters = block.getCharacterList();
  let start = aroundIndex;
  let end = aroundIndex;
  while (start >= 0 && filter(characters.get(start))) start--;
  while (end < characters.size && filter(characters.get(end))) end++;
  return Range(block.getKey(), start + 1, end);
};

export const getContiguousStyleRangesAtOffset = (block: ContentBlock, offset: number, styleKeyFilter: (styleKey: string) => boolean): Map<string, Range> => {
  const stylesAtOffset = block.getInlineStyleAt(Math.max(0, offset));
  return stylesAtOffset.reduce((ranges, style) => {
    if (styleKeyFilter(style!)) {
      return ranges!.set(style!, getContiguousStyleRange(
        block,
        style!,
        offset
      ));
    }
    return ranges!;
  }, Map<string, Range>());
};

export const getEquivalentStyleRangeAtOffset = (block: ContentBlock, offset: number): [OrderedSet<string>, Range] => {
  const stylesAtOffset = block.getInlineStyleAt(Math.max(0, offset));
  return [stylesAtOffset, getContiguousStyleRange(block, char => char.getStyle().equals(stylesAtOffset), offset)];
};

export const getContiguousStyleRangesNearOffset = (block: ContentBlock, offset: number, styleKeyFilter: (styleKey: string) => boolean): Map<string, Range> => {
  const stylesAtOffset = block.getInlineStyleAt(offset);
  const stylesAdjacentToOffset = offset > 0 ? block.getInlineStyleAt(offset - 1).subtract(stylesAtOffset) : OrderedSet<string>();
  return stylesAtOffset.union(stylesAdjacentToOffset).reduce((ranges, style) => {
    if (styleKeyFilter(style!)) {
      return ranges!.set(style!, getContiguousStyleRange(
        block,
        style!,
        stylesAdjacentToOffset.contains(style!) ? offset - 1 : offset
      ));
    }
    return ranges!;
  }, Map<string, Range>());
};

export const getContiguousStyleRangesNearSelectionEdges = (content: ContentState, selection: SelectionState, styleKeyFilter: (styleKey: string) => boolean = constant(true)): Map<string, OrderedSet<Range>> => {
  // We intentionally allow separated `content` and `selection`, so if, say,
  // you are looking at updated content at a previous selection, the blocks could be undefined.
  const startBlock: ContentBlock | undefined = content.getBlockForKey(selection.getStartKey());
  const endBlock: ContentBlock | undefined = content.getBlockForKey(selection.getEndKey());
  const stylesNearStart = startBlock
    ? getContiguousStyleRangesNearOffset(startBlock, selection.getStartOffset(), styleKeyFilter).map(value => OrderedSet([value!])) as Map<string, OrderedSet<Range>>
    : Map<string, OrderedSet<Range>>();
  return selection.isCollapsed() || !endBlock
    ? stylesNearStart
    : stylesNearStart.mergeWith((a, b) => a!.add(b!.first()), getContiguousStyleRangesNearOffset(
      endBlock,
      selection.getEndOffset(),
      styleKeyFilter
    ).map(value => Set([value!])));
};

const rangesOverlapUnidirectionally = (a: [number, number], b: [number, number]) => {
  // a:  --------     a: -------
  // b:     --------  b:   ---
  return b[0] >= a[0] && b[0] < a[1];
};

export const rangesOverlap = (a: [number, number], b: [number, number]): boolean => {
  return rangesOverlapUnidirectionally(a, b) || rangesOverlapUnidirectionally(b, a);
};

export type InsertionEdit = {
  type: 'insertion';
  text: string;
  blockKey: string;
  offset: number;
  deletionLength?: number;
  style?: OrderedSet<string>;
  disableUndo?: true;
}

export type SelectionEdit = {
  type: 'selection';
  anchorKey: string;
  anchorOffset: number;
  focusKey: string;
  focusOffset: number;
  isBackward: boolean;
  adjustFocusForInsertions?: 'leading' | 'trailing';
  adjustAnchorForInsertions?: 'leading' | 'trailing';
}

export type Edit = InsertionEdit | SelectionEdit;

export const performDependentEdits = (editorState: EditorState, edits: Edit[]) => {
  const insertions: { [blockKey: string]: number[] } = {};
  const deletions: { [blockKey: string]: number[] } = {};
  return edits.reduce((nextEditorState, edit) => {
    const content = nextEditorState.getCurrentContent();
    switch (edit.type) {
      case 'insertion':
        insertions[edit.blockKey] = insertions[edit.blockKey] || [0];
        deletions[edit.blockKey] = deletions[edit.blockKey] || [0];
        const insertOffset = edit.offset + sum(insertions[edit.blockKey].slice(0, edit.offset + 1)) - sum(deletions[edit.blockKey].slice(0, edit.offset + 1));
        insertions[edit.blockKey][edit.offset] = (insertions[edit.blockKey][edit.offset] || 0) + edit.text.length;
        deletions[edit.blockKey][edit.offset] = (deletions[edit.blockKey][edit.offset] || 0) + (edit.deletionLength || 0);
        const nextContent = Modifier.replaceText(content, createSelectionWithRange(edit.blockKey, insertOffset, insertOffset + (edit.deletionLength || 0)), edit.text, edit.style);
        const changeType = edit.text.length ? 'insert-characters' : 'remove-range';
        return edit.disableUndo ? performUnUndoableEdits(
          nextEditorState,
          disabledUndo => EditorState.push(disabledUndo, nextContent, changeType)
        ) : EditorState.push(nextEditorState, nextContent, changeType);
      case 'selection':
        insertions[edit.anchorKey] = insertions[edit.anchorKey] || [0];
        deletions[edit.anchorKey] = deletions[edit.anchorKey] || [0];
        insertions[edit.focusKey] = insertions[edit.focusKey] || [0];
        deletions[edit.focusKey] = deletions[edit.focusKey] || [0];
        const adjustFocusForInsertions = edit.adjustFocusForInsertions === 'leading' ? 0 : 1;
        const adjustAnchorForInsertions = edit.adjustAnchorForInsertions === 'leading' ? 0 : 1;
        const anchorDelta = sum(insertions[edit.anchorKey].slice(0, edit.anchorOffset + adjustAnchorForInsertions)) - sum(deletions[edit.anchorKey].slice(0, edit.anchorOffset + adjustAnchorForInsertions));
        const focusDelta = sum(insertions[edit.focusKey].slice(0, edit.focusOffset + adjustFocusForInsertions)) - sum(deletions[edit.focusKey].slice(0, edit.focusOffset + adjustFocusForInsertions));
        return EditorState.forceSelection(
          nextEditorState,
          SelectionState.createEmpty(edit.anchorKey).merge({
            anchorKey: edit.anchorKey,
            anchorOffset: edit.anchorOffset + anchorDelta,
            focusKey: edit.focusKey,
            focusOffset: edit.focusOffset + focusDelta,
            isBackward: edit.isBackward
          }) as SelectionState
        );
    }
  }, editorState);
};
