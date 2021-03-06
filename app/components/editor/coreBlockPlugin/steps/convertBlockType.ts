import { EditorState, ContentState, Modifier, ContentBlock, SelectionState } from 'draft-js';
import { blockValues, blocks, CoreBlockDefinition } from '../blocks';
import { createSelectionWithBlock, performUnUndoableEdits, createSelectionWithRange, createSelectionWithSelection } from '../../../../utils/draftUtils';
import { OrderedSet } from 'immutable';

const matchBlock = (text: string): [CoreBlockDefinition, RegExpExecArray] | [null, null] => {
  for (let block of blockValues) {
    const match = block!.pattern.exec(text);
    if (match) return [block!, match];
  }
  return [null, null];
}

const didCompleteList = (prevEditorState: EditorState, editorState: EditorState) => {
  const selection = editorState.getSelection();
  const prevSelection = prevEditorState.getSelection();
  const prevBlock = prevEditorState.getCurrentContent().getBlockForKey(prevSelection.getStartKey());
  return editorState.getLastChangeType() === 'split-block'
    && selection.isCollapsed()
    && prevSelection.isCollapsed()
    && ['unordered-list-item', 'ordered-list-item'].includes(prevBlock.getType())
    && prevBlock.getText() === '';
};

export const convertBlockType = (editorState: EditorState, prevEditorState: EditorState): EditorState => {
  const content = editorState.getCurrentContent();
  const prevContent = prevEditorState.getCurrentContent();
  if (content === prevContent) {
    return editorState;
  }

  // Special case for lists, pressing enter on an empty list item ends the list
  const selection = editorState.getSelection();
  const prevSelection = prevEditorState.getSelection();
  if (didCompleteList(prevEditorState, editorState)) {
    const blockToConvert = content.getBlockForKey(prevSelection.getStartKey());
    const blockToDelete = content.getBlockForKey(selection.getStartKey());
    const contentWithDeletedBlock = Modifier.removeRange(
      content,
      SelectionState.createEmpty(blockToConvert.getKey()).merge({
        focusKey: blockToDelete.getKey()
      }) as SelectionState,
      'backward'
    );
    const contentWithConvertedBlock = Modifier.setBlockType(
      contentWithDeletedBlock,
      createSelectionWithBlock(blockToConvert),
      'unstyled'
    );

    return performUnUndoableEdits(editorState, disabledUndoEditorState => (
      EditorState.forceSelection(
        EditorState.push(disabledUndoEditorState, contentWithConvertedBlock, 'change-block-type'),
        createSelectionWithBlock(blockToConvert)
      )
    ));
  }

  const result = content.getBlockMap()
    .skipUntil((_, key) => key === selection.getStartKey() || key === prevSelection.getStartKey())
    .takeUntil((_, key) => {
      const firstNonMatchingBlock = content.getBlockAfter(selection.getEndKey());
      return firstNonMatchingBlock && firstNonMatchingBlock.getKey() === key;
    })
    .reduce(({ content, adjustSelection }: { content: ContentState, adjustSelection: { [key: string]: number } }, block) => {
      const prevBlock = prevContent.getBlockForKey(block!.getKey()) as ContentBlock | undefined;
      // If the block wasn’t modified, don’t change it
      if (block === prevBlock) {
        return { content, adjustSelection };
      }

      const prevBlockText = prevBlock && prevBlock.getText();
      if (prevBlock && prevBlockText === "" && editorState.getLastChangeType() === 'delete-character') {
        const prevBlockNowInCurrentBlock = prevContent.getBlockAfter(prevBlock.getKey());
        return {
          content: Modifier.setBlockType(content, createSelectionWithBlock(block!), prevBlockNowInCurrentBlock.getType()),
          adjustSelection
        };
      }

      const blockText = block!.getText();
      const currentBlockType = block!.getType();
      const currentBlockDefinition = blocks[currentBlockType];
      // Non-expandable blocks have to be undone by backspacing before
      // being converted to other kinds of blocks, e.g. you can’t
      // convert a list item to a header by typing “# ” in the list item.
      if (currentBlockDefinition && !currentBlockDefinition.expandable) {
        if (!prevBlock && !currentBlockDefinition.continues) {
          return {
            content: Modifier.setBlockType(content, createSelectionWithBlock(block!), 'unstyled'),
            adjustSelection
          };
        }
        return { content, adjustSelection };
      }

      const [newBlockDefinition, match] = matchBlock(blockText);
      if (newBlockDefinition && match) {
        if (currentBlockType !== newBlockDefinition.type) {
          return {
            content: Modifier.setBlockType(
              Modifier.replaceText(
                Modifier.removeInlineStyle(
                  content,
                  createSelectionWithBlock(block!),
                  'core.block.decorator'
                ),
                createSelectionWithRange(block!, match.index, match[match[1] ? 1 : 0].length),
                newBlockDefinition.expandable ? match[1] || match[0] : '',
                OrderedSet(['core.block.decorator'])
              ),
              createSelectionWithBlock(block!),
              newBlockDefinition.type
            ),
            adjustSelection: {
              ...adjustSelection,
              [block!.getKey()]: newBlockDefinition.expandable ? 0 : match[match[1] ? 1 : 0].length - match.index
            }
          };
        }
      } else if (
        !prevBlock // If prevBlock doesn’t exist, the block is brand new and should be made unstyled
        || currentBlockType !== 'unstyled' // If block is already unstyled there’s nothing to do
          && (!currentBlockDefinition || currentBlockDefinition.expandable)
          // TODO: memoize `matchBlock` with length of 1
          // If the old block content doesn’t register as a match for its block definition,
          // then we’re about to expand it, so we shouldn’t convert it to unstyled.
          && matchBlock(prevBlockText || '')[0] === currentBlockDefinition
      ) {
        return {
          content: Modifier.removeInlineStyle(
            Modifier.setBlockType(content, createSelectionWithBlock(block!), 'unstyled'),
            createSelectionWithBlock(block!),
            'core.block.decorator'
          ),
          adjustSelection
        };
      }

      return { content, adjustSelection };
    }, { content: editorState.getCurrentContent(), adjustSelection: {} });
  
  if (result.content !== content) {
    return performUnUndoableEdits(editorState, disabledUndoEditorState => {
      const adjustSelectionForBlock = -(result.adjustSelection[selection.getStartKey()] || 0);
      return EditorState.forceSelection(
        EditorState.push(disabledUndoEditorState, result.content, 'change-block-type'),
        createSelectionWithSelection(selection, adjustSelectionForBlock, adjustSelectionForBlock)
      );
    });
  }

  return editorState;
}