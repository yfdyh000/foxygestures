'use strict';

/**
 * Executes commands that need to happen in the content script on behalf of
 * the background script.
 */
(function () {

  // Hash of handler functions for supported commands.
  var commandHandlers = {
    'historyBack'    : commandHistoryBack,
    'historyForward' : commandHistoryForward,
    'pageUp'         : commandPageUp,
    'pageDown'       : commandPageDown,
    'reloadFrame'    : commandReloadFrame,
    'scrollTop'      : commandScrollTop,
    'scrollBottom'   : commandScrollBottom,
  };

  // ---------------------------------------------------------------------------

  browser.runtime.onMessage.addListener(onMessage);

  function onMessage (message, sender) {
    switch (message.topic) {
      // Execute a command on behalf of the background script.
      case 'mg-delegateCommand':
        onDelegateCommand(message.data);
        break;
    }
    return false;
  }

  window.addEventListener('message', function (event) {
    if (event.data) {
      switch (event.data.topic) {
        case 'mg-delegateCommand':
          onDelegateCommand(event.data.data);
          break;
      }
    }
  });

  // Modify the page number parameter in a URL.
  // Tries each replacer stategy in turn until one is successful.
  function alterPageNumber (callback) {
    var replacers = [
      // Match common pagination query parameters.
      url => url.replace(
        /\b(page|p)=(\d+)\b/i,
        (match, p1, p2, offset) => p1 + '=' + callback(Number(p2))
      ),
      // Match a numeric directory in the path.
      url => url.replace(
        /\/(\d+)([/?#]|$)/,
        (match, p1, p2, offset) => ('/' + callback(Number(p1)) + p2)
      )
    ];

    // Ignore the origin component of the URL.
    var origin = String(window.location.origin);
    var noOriginPart = String(window.location.href).substring(origin.length);

    for (var i = 0; i < replacers.length; i++) {
      var newPart = replacers[i](noOriginPart);
      if (newPart !== noOriginPart) {
        window.location.href = origin + newPart;
        return;
      }
    }
  }

  // Command implementations ---------------------------------------------------

  // Execute the delegated command or pass it down the frame hierachy.
  function onDelegateCommand (data) {
    // Check if the command should be handled by this frame.
    if (data.context.scriptFrameId) {
      if (modules.mouseEvents.scriptFrameId !== data.context.scriptFrameId) {
        // This is not the correct frame.
        modules.mouseEvents.broadcast('delegateCommand', data);
        return;
      }
    }

    // Execute the delegated command in this frame.
    commandHandlers[data.command](data);
  }

  // Navigate back in history.
  function commandHistoryBack (data) {
    window.history.back();
  }

  // Navigate forward in history.
  function commandHistoryForward (data) {
    window.history.forward();
  }

  // Increment the page/number in the URL.
  function commandPageUp (data) {
    alterPageNumber(p => p + 1);
  }

  // Decrement the page/number in the URL.
  function commandPageDown (data) {
    // Clamp page down at zero.
    alterPageNumber(p => (p > 0) ? (p - 1) : 0);
  }

  // Reload the frame in the active tab.
  function commandReloadFrame (data) {
    window.location.reload();
  }

  // Scroll to the top of the frame or page.
  function commandScrollTop (data) {
    window.scrollTo(0,0);
  }

  // Scroll to the bottom of the frame or page.
  function commandScrollBottom (data) {
    window.scrollTo(0,document.body.scrollHeight);
  }

}());