/// <reference path="../draft-js-plugins-editor.d.ts" />
import * as React from 'react';
import { bindActionCreators } from 'redux';
import { EditorState, ContentState, Modifier, SelectionState } from 'draft-js';
import { default as DraftEditor, Plugin } from 'draft-js-plugins-editor';
import { connect } from 'react-redux';
import { editorSelector } from './Editor.selectors';
import * as editorActions from './Editor.actions';
import { stripEntitiesFromBlock } from '../utils/draft-utils';

const stylingEntities = [{
  name: 'inlineCode',
  rawPattern: /`([^`]+)`/g,
  format: (matchArray: RegExpMatchArray) => matchArray[1],
  createEntity: (currentContent: ContentState) => currentContent.createEntity(
    'core.styling.inlineCode',
    'MUTABLE'
  )
}];

const processChange = (editorState: EditorState, insertedCharacter: string | null, isBackspace = false): EditorState => {
  const selectionState = editorState.getSelection()
  const cursorPositionKey = selectionState.getStartKey();
  let contentState = editorState.getCurrentContent();

  // Because a single character change could change all entities in a block,
  // easiest thing to do is to delete them all and recreate them all.
  // This probably isn’t the most efficient thing, so we might need to
  // revisit this logic later if performance suffers.
  contentState = stripEntitiesFromBlock(
    contentState,
    cursorPositionKey,
    entity => entity.getType().startsWith('core.styling')
  );

  // Insert character manually:
  // If we’re inserting a character in `handleBeforeInput`, the text hasn’t yet been updated,
  // and we need to do it ourselves. In the case of `isBackspace`, the content has already
  // been updated in the `editorState` we were passed, so no need to do anything.
  if (insertedCharacter) {
    contentState = Modifier.insertText(contentState, selectionState, insertedCharacter);
  }

  const newText = contentState.getBlockForKey(cursorPositionKey).getText();

  // Go through each styling entity and reapply
  stylingEntities.forEach(style => {
    let matchArr;
    do {
      matchArr = style.rawPattern.exec(newText);
      if (matchArr) {
        contentState = style.createEntity(contentState);
        const entityKey = contentState.getLastCreatedEntityKey();
        const entitySelection = selectionState.merge({
          anchorOffset: matchArr.index,
          focusOffset: matchArr.index + matchArr[0].length
        }) as SelectionState;
        contentState = Modifier.applyEntity(contentState, entitySelection, entityKey);
      }
    } while (matchArr);
  });

  let newEditorState = EditorState.push(editorState, contentState, 'apply-entity');
  if (newEditorState !== editorState) {
    // If we manually inserted a character, we need to move the selection forward by one character.
    if (insertedCharacter) {
      const newCursorPosition = selectionState.getAnchorOffset() + 1;
      newEditorState = EditorState.forceSelection(newEditorState, selectionState.merge({
        anchorOffset: newCursorPosition,
        focusOffset: newCursorPosition
      }) as SelectionState);
    } else {
      // If we were processing a backspace, we just need to put the selection state back how it was
      // before applying the entity.
      newEditorState = EditorState.forceSelection(newEditorState, selectionState);
    }
  }

  return newEditorState;
}

const plugin: Plugin = {
  handleBeforeInput: (character, editorState, pluginProvider) => {
    const newEditorState = processChange(editorState, character);
    if (editorState !== newEditorState) {
      pluginProvider.setEditorState(newEditorState);
      return 'handled';
    }

    return 'not-handled';
  },

  onChange: editorState => {
    if (editorState.getLastChangeType() === 'backspace-character') {
      return processChange(editorState, null, true);
    }

    return editorState;
  }
}

export interface EditorProps {
  editor: EditorState;
  title: string;
  noteId: string;
}

export class Editor extends React.PureComponent<EditorProps & typeof editorActions> {
  updateEditorState = (editorState: EditorState) => {
    const { noteId } = this.props;
    this.props.updateEditor({ noteId, editorState });
  }
  render() {
    return (
      <DraftEditor
        editorState={this.props.editor}
        onChange={this.updateEditorState}
        plugins={[plugin]}
      />
    );
  }
}

export default connect(editorSelector, dispatch => bindActionCreators(editorActions, dispatch))(Editor);