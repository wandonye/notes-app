import { DraftBlockType } from 'draft-js';
import { values } from 'lodash';
import { InsertionEdit } from '../../../utils/draftUtils';
import { OrderedSet } from 'immutable';

export interface CoreBlockDefinition {
  type: DraftBlockType;
  pattern: RegExp;
  expandable?: boolean;
};

export interface CoreStaticBlockDefinition extends CoreBlockDefinition {
  expandable?: false;
  canonicalPattern: string;
  /** Whether the new block type created after pressing Enter should be the same type as the current block. */
  continues: boolean;
}

export interface CoreExpandableBlockDefinition extends CoreBlockDefinition {
  expandable: true;
  canonicalPattern: Pick<InsertionEdit, 'text' | 'style'>[];
}

export const blocks: { [K in DraftBlockType]?: CoreStaticBlockDefinition | CoreExpandableBlockDefinition } = {
  'header-one': {
    type: 'header-one',
    pattern: /^(#) /,
    expandable: true,
    canonicalPattern: [
      { text: '#', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'header-two': {
    type: 'header-two',
    pattern: /^(##) /,
    expandable: true,
    canonicalPattern: [
      { text: '##', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'header-three': {
    type: 'header-three',
    pattern: /^(###) /,
    expandable: true,
    canonicalPattern: [
      { text: '###', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'header-four': {
    type: 'header-four',
    pattern: /^(####) /,
    expandable: true,
    canonicalPattern: [
      { text: '####', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'header-five': {
    type: 'header-five',
    pattern: /^(#####) /,
    expandable: true,
    canonicalPattern: [
      { text: '#####', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'header-six': {
    type: 'header-six',
    pattern: /^(######) /,
    expandable: true,
    canonicalPattern: [
      { text: '######', style: OrderedSet(['core.block.decorator']) },
      { text: ' ' }
    ]
  },
  'blockquote': {
    type: 'blockquote',
    pattern: /^> /,
    expandable: false,
    canonicalPattern: '> ',
    continues: false
  },
  'unordered-list-item': {
    type: 'unordered-list-item',
    pattern: /^- /,
    expandable: false,
    canonicalPattern: '- ',
    continues: true
  },
  'ordered-list-item': {
    type: 'ordered-list-item',
    pattern: /1[.)] /,
    expandable: false,
    // TODO: there is no canonical pattern for ordered list items,
    // so maybe this is a bad paradigm. We should possibly store what
    // the user types in blockData and use that, or in the case of
    // ordered list items, adjust the numeric portion of the pattern
    // to reflect the actual number rendered.
    canonicalPattern: '',
    continues: true
  }
};

export const blockValues = values(blocks);