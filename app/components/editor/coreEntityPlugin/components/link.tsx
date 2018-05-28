import * as React from 'react';
import { LinkData } from '../entities/link';
import { DraftDecoratorComponentProps } from 'draft-js-plugins-editor';
import { openExternalOnCmdModifier } from '../../../../utils/openExternal';
import { isMacOS } from '../../../../utils/platform';

const onMouseDown: React.MouseEventHandler<HTMLAnchorElement> = event => {
  if (isMacOS && event.metaKey || !isMacOS && event.ctrlKey) {
    event.preventDefault();
  }
}

export const Link: React.SFC<DraftDecoratorComponentProps> = ({ children, contentState, entityKey }) => {
  const { href }: LinkData = contentState.getEntity(entityKey).getData();
  return <a href={href} onMouseDown={onMouseDown} onClick={openExternalOnCmdModifier}>{children}</a>;
};
