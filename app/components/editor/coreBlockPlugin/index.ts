import { Plugin } from 'draft-js-plugins-editor';
import { EditorState } from 'draft-js';
import { convertBlockType } from './steps/convertBlockType';
import { collapseBlocks, collapseBlocksAtSelectionEdges } from './steps/collapseBlocks';
import { expandBlocks } from './steps/expandBlocks';

export const createCoreBlockPlugin = (getEditorState: () => EditorState): Plugin => ({
  onChange: editorState => {
    const prevEditorState = getEditorState();
    const editorStateWithConvertedBlocks = convertBlockType(editorState, prevEditorState);
    const editorStateWithCollapsedBlocks = collapseBlocks(editorStateWithConvertedBlocks);
    return expandBlocks(editorStateWithCollapsedBlocks);
  },

  customStyleMap: {
    'core.block.decorator': {
      color: 'rgba(0, 0, 0, 0.3)'
    }
  }
});

export const normalizeCoreBlocks = (editorState: EditorState) => {
  return collapseBlocksAtSelectionEdges(editorState);
}
