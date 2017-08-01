'use strict';

/**
 * Executes commands that need to happen in the content script on behalf of the background script.
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
    'userScript'     : commandUserScript
  };

  // Settings for this module.
  var settings = {
    scrollDuration: 1000,
    useRelPrevNext: true
  };

  // Load settings from storage.
  browser.storage.local.get(settings).then(results => settings = results);

  // Event listeners ---------------------------------------------------------------------------------------------------

  // Listen for changes to settings.
  browser.storage.onChanged.addListener((changes, area) => {
    Object.keys(settings).forEach(key => {
      if (changes[key]) {
        settings[key] = changes[key].newValue;
      }
    });
  });

  browser.runtime.onMessage.addListener(onMessage);

  function onMessage (message, sender) {
    switch (message.topic) {
      case 'mg-delegateCommand':
        // Execute a command on behalf of the background script.
        onDelegateCommand(message.data);
        break;
    }
    return false;
  }

  window.addEventListener('message', function (event) {
    if (event.data) {
      switch (event.data.topic) {
        case 'mg-delegateCommand':
          // Execute the delegated command or pass it down the frame hierachy.
          onDelegateCommand(event.data.data);
          break;
      }
    }
  });

  // Execute the delegated command or pass it down the frame hierachy.
  function onDelegateCommand (data, sender) {
    // Check if the command should be handled by this frame.
    if (data.context.scriptFrameId && (modules.mouseEvents.scriptFrameId !== data.context.scriptFrameId)) {
      // This is not the correct frame.
      modules.mouseEvents.broadcast('delegateCommand', data);
    } else {
      // Execute the delegated command in this frame.
      commandHandlers[data.command](data);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Post a message to the given window with the given topic.
  // Typically used to send messages up the frame/window hierarchy.
  function postTo (targetWindow, topic, data) {
    targetWindow.postMessage({
      topic: 'mg-' + topic,
      data: data || {}
    }, '*');
  }

  // Attempt to format the given value similarly to the original value.
  function padSame (original, newValue) {
    // Look for leading zeros to determine padding size.
    // This will fail in some case, for example: 100 -> 99 or 099?
	  return (original[0] === '0') ? newValue.padStart(original.length, '0') : newValue;
  }

  // Modify the page number parameter in a URL.
  // Tries each replacer stategy in turn until one is successful.
  // JSFiddle to debug this algorithm: https://jsfiddle.net/Lrdgcxcs/1/
  function alterPageNumber (callback) {
    var replacers = [
      // Match common pagination query parameters.
      url => url.replace(
        /\b(page|p)=(\d+)\b/i,
        (match, p1, p2, offset) => p1 + '=' + padSame(p2, String(callback(Number(p2))))
      ),
      // Match pageXX or page/XX in the URL.
      url => url.replace(
        /\b(page\/?)(\d+)\b/i,
        (match, p1, p2, offset) => p1 + padSame(p2, String(callback(Number(p2))))
      ),
      // Generic find and replace numbers in the URL.
      // - Try to scan for numbers in the path from end to start.
      // - Try to scan for number in the query or fragment from start to end.
      url => {
        // Split the URL each time a number is enountered.
        let segments = url.split(/([\d]+)/);

        // Find the last segment of the path component.
        let lastPathSegment = segments.reduce((n, segment, i) => {
          return !!~segment.indexOf('?') || !!~segment.indexOf('#') ? Math.min(n, i) : n;
        }, segments.length - 1);

        // Look for a number in the path first.
        // Scan from end to start and increment the last number in the path.
        let done = false;
        for (let i = lastPathSegment; i >= 0; i--) {
          let value = segments[i].length ? Number(segments[i]) : Number.NaN;
          if (value >= 0) {
            segments[i] = padSame(segments[i], String(callback(value)));
            done = true;
            break;
          }
        }

        if (!done) {
          // Look for a number in query as fallback.
          // Scan from start to end and increment the first number in the query or fragment.
          for (let i = lastPathSegment; i < segments.length; i++) {
            let value = segments[i].length ? Number(segments[i]) : Number.NaN;
            if (value >= 0) {
              segments[i] = padSame(segments[i], String(callback(value)));
              break;
            }
          }
        }

        // Assemble the segments.
        return segments.join('');
      }
    ];

    // Ignore the origin component of the URL.
    var origin = String(window.location.origin);
    var noOriginPart = String(window.location.href).substring(origin.length);

    for (var i = 0; i < replacers.length; i++) {
      var newPart = replacers[i](noOriginPart);
      if (newPart !== noOriginPart) {
        window.location.href = origin + newPart;
        return true;
      }
    }
    return false;
  }

  // Follow the last rel=next or rel=prev link in the page.
  function goRelNextPrev (next) {
    let list = document.querySelectorAll(next ? 'a[rel~=next]' : 'a[rel~=prev]');
    let href = list.length && list[list.length - 1].href;
    if (href) {
      window.location.href = href;
      return true;
    }
    return false;
  }

  // Function adapted from:
  // https://github.com/danro/jquery-easing/blob/master/jquery.easing.js
  function easeOutQuad (time, initial, change, duration) {
    return -change * (time /= duration) * (time - 2) + initial;
  }

  // Smoothly scroll the window to the given offset using requestAnimationFrame().
  function scrollYEase (scrollTo, duration) {
    let start = window.performance.now();
    let initial = window.scrollY;
    let change = scrollTo - initial;
    return new Promise((resolve, reject) => {
      // Animation function to scroll based on easing function.
      function animate (step) {
        let time = (step - start);
        let value = easeOutQuad(time, initial, change, duration);
        if (time < duration) {
          // Schedule the next animation frame.
          window.scrollTo(0, value);
          window.requestAnimationFrame(animate);
        } else {
          // Finish by scrolling to the exact amount.
          window.scrollTo(0, scrollTo);
          resolve();
        }
      }

      if (duration > 0) {
        // Schedule the first animation frame.
        window.requestAnimationFrame(animate);
      } else {
        // Animation is disabled.
        window.scrollTo(0, scrollTo);
        resolve();
      }
    });
  }

  // Command implementations -------------------------------------------------------------------------------------------

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
    if (!(settings.useRelPrevNext && goRelNextPrev(true))) {
      alterPageNumber(p => p + 1);
    }
  }

  // Decrement the page/number in the URL.
  function commandPageDown (data) {
    if (!(settings.useRelPrevNext && goRelNextPrev(false))) {
      // Clamp page down at zero.
      alterPageNumber(p => (p > 0) ? (p - 1) : 0);
    }
  }

  // Reload the frame in the active tab.
  function commandReloadFrame (data) {
    window.location.reload();
  }

  // Scroll to the top of the frame or page.
  function commandScrollTop (data) {
    return scrollYEase(0, settings.scrollDuration);
  }

  // Scroll to the bottom of the frame or page.
  function commandScrollBottom (data) {
    let scrollMaxY = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    return scrollYEase(scrollMaxY, settings.scrollDuration);
  }

  // Execute a user script.
  function commandUserScript (data) {
    /* jshint evil:true */
    try {
      var mouseDown = modules.mouseEvents.getMouseDown();
      eval(data.userScript.script);
    } catch (err) {
      // Report any error with the user script.
      let label =  data.userScript.label || 'User Script';
      setStatus(label + ' error: ' + err.message);
      console.log(label, 'error', err);
    }
  }

  // User script API functions -----------------------------------------------------------------------------------------
  // These are functions that primarily exist for use with user scripts.

  // Serialize a function and send it to the background script for execution.
  // This is a mechanism for user scripts to execute code in the priviledged background context.
  function executeInBackground (func, args) {
    return browser.runtime.sendMessage({
      topic: 'mg-executeInBackground',
      data: {
        args: args || [],
        func: func.toString()
      }
    });
  }

  // Set the status text.
  function setStatus (status) {
    postTo(window.top, 'status', status);
  }

}());
