/* eslint-disable react/no-array-index-key */
import React from 'react';
import { getVisibleSelectionRect } from 'draft-js';

const getRelativeParent = (element) => {
  if (!element) {
    return null;
  }

  const position = window.getComputedStyle(element).getPropertyValue('position');
  if (position !== 'static') {
    return element;
  }

  return getRelativeParent(element.parentElement);
};


const getContainerElement = (element) => {
  if (!element) {
    return document.documentElement;
  }

  const overflowX = window.getComputedStyle(element).getPropertyValue('overflow-x');
  const overflowY = window.getComputedStyle(element).getPropertyValue('overflow-y');
  if (overflowX === 'hidden' || overflowY === 'hidden') {
    return element;
  }

  return getContainerElement(element.parentElement);
};


const getMargin = (element, side = 'left') => {
  const elementStyles = window.getComputedStyle
    ? getComputedStyle(element, null)
    : element.currentStyle;
  return parseInt(
    elementStyles[`margin${`${side.charAt(0).toUpperCase()}${side.slice(1)}`}`],
    10
  );
};

export default class Toolbar extends React.Component {
  state = {
    isVisible: false,
    position: undefined,
    /**
     * If this is set, the toolbar will render this instead of the regular
     * structure and will also be shown when the editor loses focus.
     * @type {Component}
     */
    overrideContent: undefined,
    /**
     * We are holding default toolbar width to prevent geometry changing, that
     * happens very often
     */
    width: null,
    /**
     * pointerClassName internals here. It could look like: "{ left: 1px; }"
     * @type {string}
     */
    pointerCSS: null,
  };

  componentDidMount() {
    this.props.store.subscribeToItem('selection', this.onSelectionChanged);
  }

  componentWillUnmount() {
    this.props.store.unsubscribeFromItem('selection', this.onSelectionChanged);
  }

  /**
   * This can be called by a child in order to render custom content instead
   * of the regular structure. It's the responsibility of the callee to call
   * this function again with `undefined` in order to reset `overrideContent`.
   * @param {Component} overrideContent
   */
  onOverrideContent = (overrideContent) => {
    this.setState({ overrideContent });
  };

  onSelectionChanged = () => {
    // need to wait a tick for window.getSelection() to be accurate
    // when focusing editor with already present selection
    setTimeout(() => {
      if (!this.toolbar) return;

      if (typeof this.state.width !== 'number') {
        this.setState({ width: this.toolbar.offsetWidth });
      }

      let alignment = null;
      let horizontalOffset = 0;

      // boundings of the selected text
      const selectionRect = getVisibleSelectionRect(window);
      const selection = this.props.store.getItem('getEditorState')().getSelection();
      if (selection.isCollapsed()) return;

      if (!selectionRect) return;
      const relativeParent = getRelativeParent(this.toolbar.parentElement);
      const relativeRect = (relativeParent || document.body).getBoundingClientRect();

      const containerEl = relativeParent ? getContainerElement(relativeParent) : document.body;
      const containerRect = (containerEl || document.body).getBoundingClientRect();

      // we should take into account a case when we don't have relative parent,
      // but our body has a margin
      const bodyMargin = relativeParent ? 0 : getMargin(document.body);

      const toolbarHalfWidth = this.toolbar.offsetWidth / 2;
      // calculating the middle of the text selection
      const fromBeginningToMiddle = (selectionRect.left + (selectionRect.width / 2)) - containerRect.left;
      // the same but against editor right side
      const beforeWindowEnd = containerRect.right - (selectionRect.left + (selectionRect.width / 2));

      const leftToolbarMargin = getMargin(this.toolbar);
      const rightToolbarMargin = getMargin(this.toolbar, 'right');

      // the selection is closer to parent beginning than half of the toolbar
      // +-----------------------------------------------+
      // |          vv toolbar                           |
      // | +------------------+                          |
      // | +------------------+                          |
      // |                                               |
      // |  +--+                                         |
      // |   ^^ selection                                |
      // +-----------------------------------------------+
      if (fromBeginningToMiddle < (toolbarHalfWidth + (2 * leftToolbarMargin))) {
        // shift computations are different for relative editor and body
        const leftShift = relativeRect.left - containerRect.left;
        horizontalOffset = (toolbarHalfWidth - leftShift) + leftToolbarMargin;
        alignment = 'left';
      } else if (beforeWindowEnd < (toolbarHalfWidth + (2 * rightToolbarMargin))) {
        // the same, but relative to the parent end
        // +-----------------------------------------------+
        // |                                 vvv toolbar   |
        // |                            +---------------+  |
        // |                            +---------------+  |
        // |                                               |
        // |                                      +--+     |
        // |                             selection ^^      |
        // |                                               |
        // +-----------------------------------------------+
        // shift computations are different for relative editor and body
        const rightShift = containerRect.right - relativeRect.right;
        horizontalOffset = (-toolbarHalfWidth - rightShift) + rightToolbarMargin;
        alignment = 'right';
      } else {
        // selection somewhere in the middle within the parent and there is a
        // free place for toolbar
        horizontalOffset = (selectionRect.left - relativeRect.left)
          + (((selectionRect.width / 2) + bodyMargin) - leftToolbarMargin);
      }

      // The toolbar shouldn't be positioned directly on top of the selected text,
      // but rather with a small offset so the caret doesn't overlap with the text.
      const extraTopOffset = -5;

      const position = {
        top: (selectionRect.top - relativeRect.top) - this.toolbar.offsetHeight - 10,
        [alignment || 'left']: horizontalOffset
      };
      this.setState({
        position,
        pointerCSS: this.calculatePointerPosition(
          alignment,
          selectionRect,
          fromBeginningToMiddle,
          containerRect
        )
      });
    });
  };

  getStyle() {
    const { store } = this.props;
    const { overrideContent, position } = this.state;
    const selection = store.getItem('getEditorState')().getSelection();
    // overrideContent could for example contain a text input, hence we always show overrideContent
    // TODO: Test readonly mode and possibly set isVisible to false if the editor is readonly
    const isVisible = (!selection.isCollapsed() && selection.getHasFocus()) || overrideContent;
    const style = { ...position };

    if (isVisible) {
      style.visibility = 'visible';
      style.transform = 'translate(-50%) scale(1)';
      style.transition = 'transform 0.15s cubic-bezier(.3,1.2,.2,1)';
      // toolbar width must forcibly overwritten to prevent unexpected geometry
      // changes
      style.width = this.state.width;
    } else {
      style.transform = 'translate(-50%) scale(0)';
      style.visibility = 'hidden';
    }

    return style;
  }

  /**
   * calculate toolbar pointer (css arrow) position
   * @param alignment
   * @param selectionRect
   * @param fromBeginningToMiddle
   * @param containerRect
   * @returns {string|number}
   */
  calculatePointerPosition = (
    alignment, selectionRect, fromBeginningToMiddle, containerRect
  ) => {
    if (typeof alignment === 'string') {
      if (alignment === 'left') {
        return `{ left: ${fromBeginningToMiddle - (2 * getMargin(this.toolbar))}px; }`;
      }

      return `{ left: ${this.toolbar.offsetWidth -
      (containerRect.right - (selectionRect.right - (selectionRect.width / 2)) -
        (2 * getMargin(this.toolbar, 'right')))}px; }`;
    }

    return null;
  };

  handleToolbarRef = (node) => {
    this.toolbar = node;
  };

  render() {
    const { theme, store, structure } = this.props;
    const { overrideContent: OverrideContent, pointerCSS } = this.state;
    const childrenProps = {
      theme: theme.buttonStyles,
      getEditorState: store.getItem('getEditorState'),
      setEditorState: store.getItem('setEditorState'),
      onOverrideContent: this.onOverrideContent
    };

    return (
      <div
        className={theme.toolbarStyles.toolbar}
        style={this.getStyle()}
        ref={this.handleToolbarRef}
      >
        {typeof pointerCSS === 'string' &&
          <style>
            {`.${theme.toolbarStyles.toolbar}::before, .${
            theme.toolbarStyles.toolbar}::after${pointerCSS};`}
          </style>}
        {OverrideContent
          ? <OverrideContent {...childrenProps} />
          : structure.map((Component, index) =>
            <Component key={index} {...childrenProps} />)}
      </div>
    );
  }
}
