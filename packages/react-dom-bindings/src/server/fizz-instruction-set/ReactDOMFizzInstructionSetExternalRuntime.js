/* eslint-disable dot-notation */

// Instruction set for the Fizz external runtime

import {
  clientRenderBoundary,
  completeBoundary,
  completeSegment,
  listenToFormSubmissionsForReplaying,
} from './ReactDOMFizzInstructionSetShared';

import {enableFormActions} from 'shared/ReactFeatureFlags';

export {clientRenderBoundary, completeBoundary, completeSegment};

const resourceMap = new Map();

// This function is almost identical to the version used by inline scripts
// (ReactDOMFizzInstructionSetInlineSource), with the exception of how we read
// completeBoundary and resourceMap
export function completeBoundaryWithStyles(
  suspenseBoundaryID,
  contentID,
  stylesheetDescriptors,
) {
  const precedences = new Map();
  const thisDocument = document;
  let lastResource, node;

  // Seed the precedence list with existing resources and collect hoistable style tags
  const nodes = thisDocument.querySelectorAll(
    'link[data-precedence],style[data-precedence]',
  );
  const styleTagsToHoist = [];
  for (let i = 0; (node = nodes[i++]); ) {
    if (node.getAttribute('media') === 'not all') {
      styleTagsToHoist.push(node);
    } else {
      if (node.tagName === 'LINK') {
        resourceMap.set(node.getAttribute('href'), node);
      }
      precedences.set(node.dataset['precedence'], (lastResource = node));
    }
  }

  let i = 0;
  const dependencies = [];
  let href, precedence, attr, loadingState, resourceEl, media;

  // Sheets Mode
  let sheetMode = true;
  while (true) {
    if (sheetMode) {
      // Sheet Mode iterates over the stylesheet arguments and constructs them if new or checks them for
      // dependency if they already existed
      const stylesheetDescriptor = stylesheetDescriptors[i++];
      if (!stylesheetDescriptor) {
        // enter <style> Mode
        sheetMode = false;
        i = 0;
        continue;
      }

      let avoidInsert = false;
      let j = 0;
      href = stylesheetDescriptor[j++];

      if ((resourceEl = resourceMap.get(href))) {
        // We have an already inserted stylesheet.
        loadingState = resourceEl['_p'];
        avoidInsert = true;
      } else {
        // We haven't already processed this href so we need to construct a stylesheet and hoist it
        // We construct it here and attach a loadingState. We also check whether it matches
        // media before we include it in the dependency array.
        resourceEl = thisDocument.createElement('link');
        resourceEl.href = href;
        resourceEl.rel = 'stylesheet';
        resourceEl.dataset['precedence'] = precedence =
          stylesheetDescriptor[j++];
        while ((attr = stylesheetDescriptor[j++])) {
          resourceEl.setAttribute(attr, stylesheetDescriptor[j++]);
        }
        loadingState = resourceEl['_p'] = new Promise((resolve, reject) => {
          resourceEl.onload = resolve;
          resourceEl.onerror = reject;
        });
        // Save this resource element so we can bailout if it is used again
        resourceMap.set(href, resourceEl);
      }
      media = resourceEl.getAttribute('media');
      if (
        loadingState &&
        loadingState['s'] !== 'l' &&
        (!media || window['matchMedia'](media).matches)
      ) {
        dependencies.push(loadingState);
      }
      if (avoidInsert) {
        // We have a link that is already in the document. We don't want to fall through to the insert path
        continue;
      }
    } else {
      // <style> mode iterates over not-yet-hoisted <style> tags with data-precedence and hoists them.
      resourceEl = styleTagsToHoist[i++];
      if (!resourceEl) {
        // we are done with all style tags
        break;
      }

      precedence = resourceEl.getAttribute('data-precedence');
      resourceEl.removeAttribute('media');
    }

    // resourceEl is either a newly constructed <link rel="stylesheet" ...> or a <style> tag requiring hoisting
    const prior = precedences.get(precedence) || lastResource;
    if (prior === lastResource) {
      lastResource = resourceEl;
    }
    precedences.set(precedence, resourceEl);

    // Finally, we insert the newly constructed instance at an appropriate location
    // in the Document.
    if (prior) {
      prior.parentNode.insertBefore(resourceEl, prior.nextSibling);
    } else {
      const head = thisDocument.head;
      head.insertBefore(resourceEl, head.firstChild);
    }
  }

  Promise.all(dependencies).then(
    completeBoundary.bind(null, suspenseBoundaryID, contentID, ''),
    completeBoundary.bind(
      null,
      suspenseBoundaryID,
      contentID,
      'Resource failed to load',
    ),
  );
}

if (enableFormActions) {
  listenToFormSubmissionsForReplaying();
}
