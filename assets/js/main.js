/* ==========================================================================
   Damneth Tours & Travels: site behaviour
   Vanilla JS, no dependencies, shared by every page. Each feature checks
   that its elements exist before doing anything.
   ========================================================================== */
(() => {
  'use strict';

  const WHATSAPP_NUMBER = '94773980966';
  const BOOKINGS_EMAIL = 'damnethtoursandtravels@gmail.com';
  const TRIP_KEY = 'damneth-trip';

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopNav = window.matchMedia('(min-width: 64em)');
  const scrollBehavior = () => (reduceMotion.matches ? 'auto' : 'smooth');
  const waUrl = (message) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  /* Text in the visitor's language comes from assets/js/i18n.js, which runs first. Messages
     sent to us (WhatsApp, email) stay in English, with a line saying which language to reply in. */
  const { i18n } = window;
  const t = (name, vars) => (i18n ? i18n.t(name, vars) : name);
  const label = (value) => (i18n ? i18n.label(value) : value);
  const isRtl = () => document.documentElement.dir === 'rtl';
  const replyLanguage = () => {
    const lang = i18n && i18n.languages[i18n.lang];
    return lang && i18n.lang !== 'en' ? `${lang.english} (${lang.name})` : '';
  };
  // Keeps an email address or other left-to-right text in one piece inside a Hebrew sentence.
  const isolate = (text) => `⁨${text}⁩`;

  /* iOS Safari only shows :active pressed states once a touch listener exists */
  document.addEventListener('touchstart', () => {}, { passive: true });

  /* ---------- Sticky header ---------- */
  const header = $('.site-header');

  const updateHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  };

  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  /* ---------- Mobile menu ---------- */
  const navToggle = $('.nav-toggle');
  const nav = $('#site-nav');

  const setMenu = (open, { returnFocus = false } = {}) => {
    if (!navToggle || !nav) return;
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', t(open ? 'menu_close' : 'menu_open'));
    nav.classList.toggle('is-open', open);
    if (header) header.classList.toggle('menu-open', open);
    document.body.classList.toggle('menu-open', open);
    // Everything behind the open menu is made inert so focus can't wander off.
    // Looked up each time because the trip dock is added later.
    $$('main, .site-footer, .contact-stack, .trip-dock, .skip-link').forEach((el) => { el.inert = open; });
    if (!open && returnFocus) navToggle.focus();
  };

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setMenu(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setMenu(false, { returnFocus: true });
      }
    });

    desktopNav.addEventListener('change', (event) => {
      if (event.matches) setMenu(false);
    });

    document.addEventListener('i18n:change', () => {
      navToggle.setAttribute('aria-label', t(nav.classList.contains('is-open') ? 'menu_close' : 'menu_open'));
    });
  }

  /* ---------- Hero background video ---------- */
  // The <source media> query already keeps phones, tablets and reduced-motion visitors on the
  // photo without downloading anything, and the inline script after the <video> switches it to
  // "not all" on Save-Data or slow connections. This adds the fade-in once frames are playing,
  // pausing while the hero is off screen, and the pause button.
  const heroVideo = $('.hero__video');

  if (heroVideo) {
    const hero = heroVideo.closest('.hero');
    const toggle = $('[data-video-toggle]', hero);
    const sources = $$('source', heroVideo);
    const wanted = window.matchMedia(sources[0]?.media || 'all');
    const allowed = () => wanted.matches;
    let onScreen = true;
    let paused = false; // by the visitor

    const setPaused = (value) => {
      paused = value;
      if (toggle) toggle.setAttribute('aria-pressed', String(value));
    };

    // Detaching the sources and reloading cancels a download that has already started
    // in browsers that ignore <source media>.
    const setSources = (on) => {
      if (!sources.length || (sources[0].parentNode === heroVideo) === on) return;
      if (on) heroVideo.append(...sources);
      else sources.forEach((source) => source.remove());
      heroVideo.load();
    };

    const sync = () => {
      const on = allowed();
      hero.classList.toggle('has-video', on);
      if (on && onScreen && !paused && !document.hidden) {
        heroVideo.play().catch((error) => {
          // Autoplay refused (e.g. battery saver): keep the photo and let the button start it.
          if (error.name === 'NotAllowedError') setPaused(true);
        });
      } else {
        heroVideo.pause();
      }
    };

    if (!allowed()) setSources(false);

    heroVideo.addEventListener('playing', () => heroVideo.classList.add('is-ready'));

    wanted.addEventListener('change', () => {
      // The window has grown into the video's media query: pick up the source now.
      if (allowed()) {
        if (sources[0]?.parentNode !== heroVideo) setSources(true);
        else if (!heroVideo.currentSrc) heroVideo.load();
      }
      sync();
    });

    if (toggle) {
      toggle.addEventListener('click', () => {
        setPaused(!paused);
        sync();
      });
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      }).observe(hero);
    }

    document.addEventListener('visibilitychange', sync);
    sync();
  }

  /* ---------- Destinations carousel ---------- */
  $$('[data-carousel]').forEach((carousel) => {
    const track = $('.carousel__track', carousel);
    const prev = $('[data-carousel-prev]', carousel);
    const next = $('[data-carousel-next]', carousel);
    const bar = $('.carousel__bar', carousel);
    if (!track) return;

    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      // Right to left, scrollLeft counts down from 0, so the distance from the start is its size.
      const at = Math.abs(track.scrollLeft);
      if (prev) prev.disabled = at <= 4;
      if (next) next.disabled = at >= max - 4;
      if (bar) {
        const progress = track.scrollWidth ? (at + track.clientWidth) / track.scrollWidth : 1;
        bar.style.setProperty('--progress', Math.min(1, progress).toFixed(3));
      }
    };

    const step = (direction) => {
      const card = $('.dest-card', track);
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const cardWidth = card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
      // Move by as many whole cards as fit, at least one.
      const distance = Math.max(cardWidth, Math.floor(track.clientWidth / cardWidth) * cardWidth);
      track.scrollBy({ left: direction * distance * (isRtl() ? -1 : 1), behavior: scrollBehavior() });
    };

    if (prev) prev.addEventListener('click', () => step(-1));
    if (next) next.addEventListener('click', () => step(1));

    let frame = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  });

  /* ---------- My trip: places, experiences and a journey, kept across pages ---------- */
  const cleanList = (value) => (Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()))]
    : []);

  // localStorage can be blocked (private mode, strict settings); the trip then
  // lives in memory for this page only.
  const loadTrip = () => {
    let data = {};
    try {
      data = JSON.parse(window.localStorage.getItem(TRIP_KEY) || '{}') || {};
    } catch (error) {
      data = {};
    }
    return {
      places: cleanList(data.places),
      experiences: cleanList(data.experiences),
      journey: typeof data.journey === 'string' && data.journey.trim() ? data.journey : null,
    };
  };

  let trip = loadTrip();

  const saveTrip = () => {
    try {
      window.localStorage.setItem(TRIP_KEY, JSON.stringify(trip));
    } catch (error) {
      /* storage unavailable: keep the in-memory copy */
    }
  };

  const tripItems = () => [
    ...(trip.journey ? [trip.journey] : []),
    ...trip.places,
    ...trip.experiences,
  ];

  const tripMessage = (journey = trip.journey) => {
    const lines = ['Hi Damneth, I’d like help planning a trip to Sri Lanka.', ''];
    if (journey) lines.push(`Journey: ${journey}`);
    if (trip.places.length) lines.push(`Places: ${trip.places.join(', ')}`);
    if (trip.experiences.length) lines.push(`Experiences: ${trip.experiences.join(', ')}`);
    if (replyLanguage()) lines.push(`Preferred language: ${replyLanguage()}`);
    lines.push('', 'Could you send me a free quote?');
    return lines.join('\n');
  };

  // A polite live region for "added" and "removed" messages.
  const announcer = document.createElement('p');
  announcer.className = 'visually-hidden';
  announcer.setAttribute('role', 'status');
  announcer.dataset.tripAnnounce = '';
  document.body.append(announcer);

  let announceTimer = 0;
  const announce = (message) => {
    announcer.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { announcer.textContent = message; }, 60);
  };

  /* Floating trip dock, shown once something is in the trip */
  const quoteForm = $('[data-quote-form]');
  const dock = document.createElement('aside');
  dock.className = 'trip-dock theme-dark';
  dock.innerHTML = `
    <div class="trip-dock__summary">
      <span class="trip-dock__count" aria-hidden="true" data-dock-count>0</span>
      <div class="trip-dock__text">
        <p class="trip-dock__label" data-dock-label></p>
        <p class="trip-dock__list" data-dock-list></p>
      </div>
    </div>
    <div class="trip-dock__actions">
      <a class="btn btn--accent" href="${waUrl(tripMessage())}" target="_blank" rel="noopener" data-wa-trip>
        <svg class="icon" aria-hidden="true"><use href="#i-whatsapp"/></svg>
        <span><span class="trip-dock__verb" data-dock-verb></span><span translate="no">WhatsApp</span></span><span class="visually-hidden" data-dock-new-tab></span>
      </a>
      <a class="btn btn--outline" href="${quoteForm ? '#plan' : 'index.html#plan'}" data-dock-quote></a>
      <button class="trip-dock__clear" type="button" data-trip-clear>
        <svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>
      </button>
    </div>`;
  document.body.append(dock);

  const dockText = () => {
    dock.setAttribute('aria-label', t('trip_dock'));
    $('[data-dock-verb]', dock).textContent = `${t('dock_send_on')} `;
    $('[data-dock-new-tab]', dock).textContent = ` ${t('new_tab')}`;
    $('[data-dock-quote]', dock).textContent = t('dock_quote');
    $('[data-trip-clear]', dock).setAttribute('aria-label', t('dock_clear'));
  };
  dockText();

  const tripToggles = $$('.trip-toggle[data-place], .trip-toggle[data-experience], .trip-toggle[data-journey]');
  const tripStatus = $('[data-trip-status]');
  const emptyTripText = tripStatus ? tripStatus.textContent : '';

  const toggleInfo = (toggle) => {
    if (toggle.dataset.place) return { kind: 'places', value: toggle.dataset.place };
    if (toggle.dataset.experience) return { kind: 'experiences', value: toggle.dataset.experience };
    return { kind: 'journey', value: toggle.dataset.journey };
  };

  const hasItem = (kind, value) => (kind === 'journey' ? trip.journey === value : trip[kind].includes(value));

  const renderPicks = () => {
    $$('[data-trip-picks]').forEach((box) => {
      box.replaceChildren();
      const items = [
        ...(trip.journey ? [{ kind: 'journey', value: trip.journey }] : []),
        ...trip.places.map((value) => ({ kind: 'places', value })),
        ...trip.experiences.map((value) => ({ kind: 'experiences', value })),
      ];

      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'picks__empty';
        empty.textContent = box.dataset.empty || t('picks_empty');
        box.append(empty);
        return;
      }

      items.forEach(({ kind, value }) => {
        const pick = document.createElement('span');
        pick.className = kind === 'journey' ? 'pick pick--journey' : 'pick';
        pick.append(label(value));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pick__remove';
        remove.dataset.removeKind = kind;
        remove.dataset.removeValue = value;
        remove.setAttribute('aria-label', t('pick_remove', { item: label(value) }));
        remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
        pick.append(remove);
        box.append(pick);
      });
    });
  };

  const renderStatus = () => {
    if (!tripStatus) return;
    const items = tripItems();
    if (!items.length) {
      // The page's own "nothing added yet" sentence, in the current language.
      if (i18n) i18n.refresh(tripStatus);
      else tripStatus.textContent = emptyTripText;
      return;
    }
    const [before, after = ''] = t('trip_so_far').split('{items}');
    const list = document.createElement('span');
    list.className = 'trip-tray__places';
    list.textContent = items.map(label).join(', ');
    tripStatus.replaceChildren(before, list, after);
  };

  const renderDock = () => {
    const items = tripItems();
    $('[data-dock-count]', dock).textContent = String(items.length);
    $('[data-dock-label]', dock).textContent = t('dock_label', { n: items.length });
    $('[data-dock-list]', dock).textContent = items.map(label).join(' · ');
  };

  const renderWaLinks = () => {
    $$('[data-wa-trip]').forEach((link) => {
      if (!link.dataset.waFallback) link.dataset.waFallback = link.getAttribute('href') || '';
      const journey = link.dataset.waJourney || trip.journey;
      const hasContent = journey || trip.places.length || trip.experiences.length;
      link.href = hasContent ? waUrl(tripMessage(journey)) : link.dataset.waFallback;
    });
  };

  // Hooks added by the planner form (home page only).
  const renderHooks = [];

  const renderTrip = () => {
    tripToggles.forEach((toggle) => {
      const { kind, value } = toggleInfo(toggle);
      const on = hasItem(kind, value);
      toggle.setAttribute('aria-pressed', String(on));
      const text = $('.trip-toggle__text', toggle);
      if (text) {
        text.textContent = on
          ? (toggle.dataset.textOn || t('toggle_on'))
          : (toggle.dataset.textOff || t('toggle_off'));
      }
    });
    renderPicks();
    renderStatus();
    renderDock();
    renderWaLinks();
    renderHooks.forEach((hook) => hook());
    document.dispatchEvent(new CustomEvent('trip:change'));
  };

  const setItem = (kind, value, on) => {
    if (kind === 'journey') {
      const previous = trip.journey;
      trip.journey = on ? value : null;
      saveTrip();
      renderTrip();
      if (on && previous && previous !== value) announce(t('announce_replaces', { item: label(value), previous: label(previous) }));
      else announce(t(on ? 'announce_added' : 'announce_removed', { item: label(value) }));
      return;
    }
    const list = trip[kind].filter((item) => item !== value);
    if (on) list.push(value);
    trip[kind] = list;
    saveTrip();
    renderTrip();
    announce(t(on ? 'announce_added' : 'announce_removed', { item: label(value) }));
  };

  tripToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const { kind, value } = toggleInfo(toggle);
      setItem(kind, value, !hasItem(kind, value));
    });
  });

  // Remove buttons inside the live picks list. Focus moves to a neighbour
  // because the list is rebuilt.
  document.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-kind]');
    if (!remove) return;
    const box = remove.closest('[data-trip-picks]');
    const index = box ? $$('.pick__remove', box).indexOf(remove) : -1;
    setItem(remove.dataset.removeKind, remove.dataset.removeValue, false);
    if (!box) return;
    const buttons = $$('.pick__remove', box);
    const target = buttons[Math.min(index, buttons.length - 1)];
    if (target) {
      target.focus();
    } else {
      box.tabIndex = -1;
      box.focus();
    }
  });

  $('[data-trip-clear]', dock).addEventListener('click', () => {
    trip = { places: [], experiences: [], journey: null };
    saveTrip();
    renderTrip();
    announce(t('announce_cleared'));
    const main = $('main');
    if (main) {
      if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  });

  // "Get a quote for this journey" links save the journey, then carry on to the planner.
  $$('[data-journey-quote]').forEach((link) => {
    link.addEventListener('click', () => {
      trip.journey = link.dataset.journeyQuote;
      saveTrip();
      renderTrip();
    });
  });

  // Keep pages in sync when the trip changes in another tab.
  window.addEventListener('storage', (event) => {
    if (event.key !== TRIP_KEY && event.key !== null) return;
    trip = loadTrip();
    renderTrip();
  });

  // A new language: i18n.js has already put the page's own text back, so redraw ours over it.
  document.addEventListener('i18n:change', () => {
    dockText();
    renderTrip();
  });

  /* ---------- Service links pre-select an interest in the planner ---------- */
  $$('[data-interest]').forEach((link) => {
    link.addEventListener('click', () => {
      const input = $$('input[name="interests"]').find((el) => el.value === link.dataset.interest);
      if (input) input.checked = true;
    });
  });

  /* ---------- Quote planner form ---------- */
  const form = quoteForm;

  if (form) {
    const status = $('[data-form-status]', form);
    const nameInput = form.elements.namedItem('name');
    const emailInput = form.elements.namedItem('email');
    const travellersInput = form.elements.namedItem('travellers');
    const dateInput = form.elements.namedItem('arrival');
    let lastSubmitter = null;

    /* Trip sync: the planner's place and experience chips mirror the trip */
    const makeChip = (name, value) => {
      const chip = document.createElement('label');
      chip.className = 'chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = name;
      input.value = value;
      const span = document.createElement('span');
      span.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>';
      span.append(label(value));
      chip.append(input, span);
      return chip;
    };

    const syncGroup = (name, kind) => {
      const group = $(`[data-chip-group="${name}"]`, form);
      if (!group) return;

      const inputs = () => $$(`input[name="${name}"]`, group);

      group.addEventListener('change', (event) => {
        const input = event.target.closest(`input[name="${name}"]`);
        if (input) setItem(kind, input.value, input.checked);
      });

      renderHooks.push(() => {
        trip[kind].forEach((value) => {
          if (!inputs().some((input) => input.value === value)) group.append(makeChip(name, value));
        });
        inputs().forEach((input) => { input.checked = trip[kind].includes(input.value); });
      });
    };

    syncGroup('places', 'places');
    syncGroup('experiences', 'experiences');

    /* A chosen journey shows up as its own chip, and sets the trip length */
    const journeyField = $('[data-journey-field]', form);
    const journeyInput = journeyField ? $('input[name="journey"]', journeyField) : null;
    const journeyName = journeyField ? $('[data-journey-name]', journeyField) : null;

    if (journeyField && journeyInput) {
      journeyInput.addEventListener('change', () => {
        setItem('journey', journeyInput.value, journeyInput.checked);
      });

      renderHooks.push(() => {
        if (trip.journey) {
          journeyField.hidden = false;
          journeyInput.value = trip.journey;
          journeyInput.checked = true;
          if (journeyName) journeyName.textContent = label(trip.journey);

          const days = /^(\d+)-Day/i.exec(trip.journey);
          const lengths = $$('input[name="length"]', form);
          if (days && !lengths.some((input) => input.checked)) {
            const match = lengths.find((input) => input.value === `${days[1]} days`);
            if (match) match.checked = true;
          }
        } else {
          // Leave an unticked chip in place so it can be ticked again.
          journeyInput.checked = false;
        }
      });
    }

    // No arrival dates in the past.
    if (dateInput) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      dateInput.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    // Our own messages replace the browser's validation bubbles.
    form.noValidate = true;

    const setError = (input, message) => {
      const error = document.getElementById(`${input.id}-error`);
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      if (error) error.textContent = message;
    };

    const validate = () => {
      const problems = [];

      if (nameInput) {
        const ok = nameInput.value.trim().length > 0;
        setError(nameInput, ok ? '' : t('err_name'));
        if (!ok) problems.push(nameInput);
      }

      if (emailInput) {
        const value = emailInput.value.trim();
        const ok = value === '' || (!emailInput.validity.typeMismatch && /\S+@\S+\.\S+/.test(value));
        setError(emailInput, ok ? '' : t('err_email'));
        if (!ok) problems.push(emailInput);
      }

      if (travellersInput) {
        const raw = travellersInput.value.trim();
        const n = Number(raw);
        const ok = raw === '' || (Number.isInteger(n) && n >= 1 && n <= 60);
        setError(travellersInput, ok ? '' : t('err_travellers'));
        if (!ok) problems.push(travellersInput);
      }

      return problems;
    };

    // The last status shown, so it can be shown again in a new language.
    let statusShown = null;
    const showStatus = (name, vars = {}, isError = false) => {
      statusShown = name ? [name, vars, isError] : null;
      if (!status) return;
      status.textContent = name ? t(name, vars) : '';
      status.classList.toggle('form-status--error', isError);
    };

    const formatDate = (value) => {
      const [y, m, d] = value.split('-').map(Number);
      if (!y || !m || !d) return value;
      return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const buildMessage = () => {
      const data = new FormData(form);
      const value = (key) => String(data.get(key) || '').trim();
      const list = (key) => data.getAll(key).map(String);

      const lines = ['Hi Damneth, I’d like a free quote for a trip to Sri Lanka.', ''];
      const add = (label, text) => { if (text) lines.push(`${label}: ${text}`); };

      add('Name', value('name'));
      add('Email', value('email'));
      add('Arrival date', value('arrival') && formatDate(value('arrival')));
      add('Travellers', value('travellers'));
      add('Trip length', value('length'));
      add('Journey', value('journey'));
      add('Places', list('places').join(', '));
      add('Experiences', list('experiences').join(', '));
      add('Also interested in', list('interests').join(', '));
      add('Preferred language', replyLanguage());
      if (value('notes')) lines.push('', value('notes'));

      return lines.join('\n');
    };

    // Fallback for browsers without SubmitEvent.submitter.
    $$('button[type="submit"]', form).forEach((button) => {
      button.addEventListener('click', () => { lastSubmitter = button; });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const problems = validate();
      if (problems.length) {
        showStatus('form_check', {}, true);
        problems[0].focus();
        return;
      }

      const submitter = event.submitter || lastSubmitter;
      const via = submitter && submitter.value === 'email' ? 'email' : 'whatsapp';
      const message = buildMessage();

      if (via === 'whatsapp') {
        window.open(waUrl(message), '_blank', 'noopener');
        showStatus('form_whatsapp');
      } else {
        const subject = encodeURIComponent('Free quote request: Sri Lanka trip');
        window.location.href = `mailto:${BOOKINGS_EMAIL}?subject=${subject}&body=${encodeURIComponent(message)}`;
        showStatus('form_email', { email: isolate(BOOKINGS_EMAIL) });
      }
    });

    // Clear an error as soon as the field is fixed.
    [nameInput, emailInput, travellersInput].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => {
        if (input.getAttribute('aria-invalid') === 'true') {
          validate();
          if (!$('[aria-invalid="true"]', form)) showStatus(null);
        }
      });
    });

    // A new language: errors and the status line are ours, so redraw them.
    document.addEventListener('i18n:change', () => {
      if ($('[aria-invalid="true"]', form)) validate();
      if (statusShown) showStatus(...statusShown);
    });
  }

  renderTrip();

  /* ---------- Filter tabs (destinations by region, journal by category) ---------- */
  // Keeps a grid tidy whatever is filtered: CSS widens the first and last
  // visible cards so no row is left with a lonely gap.
  const balanceGrid = (grid) => {
    const visible = Array.from(grid.children).filter((child) => !child.hidden);
    Array.from(grid.children).forEach((child) => child.classList.remove('is-lead', 'is-tail'));
    grid.toggleAttribute('data-odd', visible.length % 2 === 1);
    grid.dataset.rest = String(visible.length % 3);
    if (visible.length) {
      visible[0].classList.add('is-lead');
      visible[visible.length - 1].classList.add('is-tail');
    }
  };

  const filters = $$('.filter[data-filter-scope]').map((filter) => {
    const scopes = $$(filter.dataset.filterScope);
    const buttons = $$('.filter__btn', filter);
    const bar = filter.closest('.filter-bar') || filter;
    const status = $('[data-filter-status]', bar);
    // "region,regions" → the filter_all_regions / filter_some_regions messages
    const noun = (filter.dataset.filterNoun || 'item,items').split(',').pop();
    let current = 'all';
    const items = scopes.flatMap((scope) => $$('[data-filter-group]', scope));

    const apply = (value, { scroll = false } = {}) => {
      current = value;
      let shown = 0;
      let counted = 0;
      items.forEach((item) => {
        const show = value === 'all' || item.dataset.filterGroup.split(' ').includes(value);
        item.hidden = !show;
        // Only the first scope's items are counted (cards, not their long-form guides).
        if (show && scopes[0] && scopes[0].contains(item)) shown += 1;
        if (scopes[0] && scopes[0].contains(item)) counted += 1;
      });

      buttons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.filter === value));
      });

      scopes.forEach((scope) => {
        if (scope.matches('[data-balance]')) balanceGrid(scope);
        $$('[data-balance]', scope).forEach(balanceGrid);
      });

      if (status) {
        const active = buttons.find((button) => button.dataset.filter === value);
        const name = active ? (active.dataset.filterName || '') : '';
        status.textContent = value === 'all'
          ? t(`filter_all_${noun}`, { n: counted })
          : t(`filter_some_${noun}`, { n: shown, name });
      }

      // Bring the top of the results back under the sticky bar if we've scrolled past it.
      if (scroll && scopes[0]) {
        const barBottom = bar.getBoundingClientRect().bottom;
        const top = scopes[0].getBoundingClientRect().top;
        if (top < barBottom) {
          window.scrollTo({ top: window.scrollY + top - barBottom, behavior: scrollBehavior() });
        }
      }
    };

    buttons.forEach((button) => {
      button.addEventListener('click', () => apply(button.dataset.filter, { scroll: true }));
    });

    const start = buttons.find((button) => button.getAttribute('aria-pressed') === 'true');
    apply(start ? start.dataset.filter : 'all');
    document.addEventListener('i18n:change', () => apply(current));

    return { items, apply };
  });

  // An in-page link to something a filter has hidden shows everything again first.
  const revealTarget = (id) => {
    const target = id && document.getElementById(id);
    if (!target) return;
    filters.forEach(({ items, apply }) => {
      if (items.some((item) => item.hidden && item.contains(target))) apply('all');
    });
  };

  if (filters.length) {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href*="#"]');
      if (!link || link.pathname !== window.location.pathname) return;
      revealTarget(decodeURIComponent(link.hash.slice(1)));
    });
    window.addEventListener('hashchange', () => revealTarget(decodeURIComponent(window.location.hash.slice(1))));
  }

  $$('[data-balance]').forEach((grid) => {
    if (!filters.some(({ items }) => items.some((item) => grid.contains(item)))) balanceGrid(grid);
  });

  /* ---------- Floating contact stack and trip dock ---------- */
  const contactStack = $('.contact-stack');
  const footer = $('.site-footer');
  // The dock hides over sections that already have their own WhatsApp action.
  const floatHiders = $$('.hero, .service-card--help, #plan, .site-footer, [data-float-hide]');
  const inView = new Set();
  let footerInView = false;

  const updateFloats = () => {
    const clear = inView.size === 0;
    const dockUp = clear && tripItems().length > 0;
    dock.classList.toggle('is-visible', dockUp);
    // The stack stays put everywhere else, so the thumb always finds it, but it slides
    // aside for the footer's own links and for the dock, which sends the trip instead.
    if (contactStack) contactStack.classList.toggle('is-hidden', footerInView || dockUp);
  };

  if (contactStack && footer && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      footerInView = entry.isIntersecting;
      updateFloats();
    }).observe(footer);
  }

  if (floatHiders.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      });
      updateFloats();
    }, { threshold: 0.12 });
    floatHiders.forEach((el) => observer.observe(el));
  }

  updateFloats();
  document.addEventListener('trip:change', updateFloats);

  /* ---------- Sideways scrollers: edge fades ---------- */
  // Filter and jump rows scroll sideways on phones. Marking which ends still hide chips
  // lets CSS fade just those edges, so a cut-off chip reads as "more this way".
  const edgeRows = $$('.filter, .jump');

  const markEdges = (row) => {
    const max = row.scrollWidth - row.clientWidth;
    const x = Math.abs(row.scrollLeft);
    if (max <= 1) row.dataset.edge = 'none';
    else if (x <= 1) row.dataset.edge = 'start';
    else if (x >= max - 1) row.dataset.edge = 'end';
    else row.dataset.edge = 'middle';
  };

  edgeRows.forEach((row) => {
    markEdges(row);
    row.addEventListener('scroll', () => markEdges(row), { passive: true });
  });

  if (edgeRows.length && 'ResizeObserver' in window) {
    const rowObserver = new ResizeObserver((entries) => entries.forEach(({ target }) => markEdges(target)));
    edgeRows.forEach((row) => rowObserver.observe(row));
  }

  /* ---------- Scroll reveal ---------- */
  const reveals = $$('.reveal');

  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    reveals.forEach((el) => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach((el) => observer.observe(el));
  }

  /* ---------- Gallery lightbox ---------- */
  // The tiles are plain links to the full-size file, so without JS (or with a
  // modifier key held) they still open the photo or video on its own.
  const lightbox = $('#lightbox');

  if (lightbox && typeof lightbox.showModal === 'function') {
    const stage = $('[data-lightbox-stage]', lightbox);
    const indexEl = $('[data-lightbox-index]', lightbox);
    const totalEl = $('[data-lightbox-total]', lightbox);
    const catEl = $('[data-lightbox-cat]', lightbox);
    const titleEl = $('[data-lightbox-title]', lightbox);
    const statusEl = $('[data-lightbox-status]', lightbox);
    const closeBtn = $('[data-lightbox-close]', lightbox);
    let list = [];
    let index = 0;
    let current = null;
    let swiped = false;

    // Largest size that fits the stage without changing the shape.
    const sizeFor = (ratio) => {
      const box = stage.getBoundingClientRect();
      const width = Math.min(box.width, box.height * ratio);
      return { width, height: width / ratio };
    };

    const fit = (media) => {
      const { width, height } = sizeFor(Number(media.dataset.ratio));
      media.style.width = `${Math.floor(width)}px`;
      media.style.height = `${Math.floor(height)}px`;
    };

    const build = (tile) => {
      const ratio = Number(tile.dataset.width) / Number(tile.dataset.height);
      let media;
      if (tile.dataset.lightbox === 'video') {
        media = document.createElement('video');
        media.controls = true;
        media.preload = 'auto';
        media.setAttribute('playsinline', '');
        media.poster = tile.dataset.poster || '';
        media.src = tile.getAttribute('href');
        media.setAttribute('aria-label', t('lightbox_video_label', { alt: tile.dataset.alt || tile.dataset.title || '' }));
      } else {
        const thumb = $('img', tile);
        media = document.createElement('img');
        media.alt = thumb ? thumb.alt : (tile.dataset.title || '');
        media.draggable = false;
        media.decoding = 'async';
        // sizes before srcset, so the browser fetches the right file first time
        media.sizes = `${Math.ceil(sizeFor(ratio).width)}px`;
        if (tile.dataset.srcset) media.srcset = tile.dataset.srcset;
        media.src = tile.getAttribute('href');
      }
      media.className = 'lightbox__media';
      media.dataset.ratio = String(ratio);
      return media;
    };

    // --dir is the way a photo moves on screen; "next" comes in from the left in Hebrew.
    const onScreen = (dir) => String(isRtl() ? -dir : dir);

    const retire = (media, dir) => {
      if (media.tagName === 'VIDEO') media.pause();
      media.style.setProperty('--dir', onScreen(dir));
      media.classList.remove('is-shown');
      media.classList.add('is-leaving');
      window.setTimeout(() => media.remove(), reduceMotion.matches ? 0 : 400);
    };

    // Warms the cache for the photos either side, so stepping through is instant.
    const preload = (i) => {
      const tile = list[(i + list.length) % list.length];
      if (!tile || tile.dataset.lightbox !== 'image' || !tile.dataset.srcset) return;
      const img = new Image();
      img.sizes = `${Math.ceil(sizeFor(Number(tile.dataset.width) / Number(tile.dataset.height)).width)}px`;
      img.srcset = tile.dataset.srcset;
    };

    const show = (next, dir = 0) => {
      index = (next + list.length) % list.length;
      const tile = list[index];
      const media = build(tile);
      media.style.setProperty('--dir', onScreen(dir));
      fit(media);
      current = media;
      stage.append(media);

      // The old photo stays put until the new one has decoded, then they cross-fade.
      const ready = media.tagName === 'IMG' && media.decode ? media.decode().catch(() => {}) : Promise.resolve();
      ready.then(() => {
        if (current !== media) return;
        $$('.lightbox__media', stage).forEach((el) => {
          if (el !== media && !el.classList.contains('is-leaving')) retire(el, dir);
        });
        requestAnimationFrame(() => requestAnimationFrame(() => media.classList.add('is-shown')));
        if (media.tagName === 'VIDEO') media.play().catch(() => {});
      });

      indexEl.textContent = String(index + 1);
      totalEl.textContent = String(list.length);
      catEl.textContent = tile.dataset.category || '';
      titleEl.textContent = tile.dataset.title || '';
      statusEl.textContent = t(tile.dataset.lightbox === 'video' ? 'lightbox_video' : 'lightbox_photo', { n: index + 1, total: list.length, title: tile.dataset.title || '' });

      if (list.length > 1) {
        preload(index + 1);
        preload(index - 1);
      }
    };

    const step = (dir) => {
      if (list.length > 1) show(index + dir, dir);
    };

    const open = (tile) => {
      // Only what the current filter shows, in the order it's shown.
      list = $$('a[data-lightbox]').filter((link) => !link.closest('[hidden]'));
      lightbox.toggleAttribute('data-single', list.length < 2);
      lightbox.classList.remove('is-closing');
      document.documentElement.classList.add('lightbox-open');
      lightbox.showModal();
      closeBtn.focus();
      show(Math.max(0, list.indexOf(tile)), 0);
    };

    const requestClose = () => {
      if (!lightbox.open || lightbox.classList.contains('is-closing')) return;
      $$('video', stage).forEach((video) => video.pause());
      if (reduceMotion.matches) {
        lightbox.close();
        return;
      }
      lightbox.classList.add('is-closing');
      window.setTimeout(() => lightbox.close(), 170);
    };

    // Runs however the dialog closes, so the page is always left tidy.
    lightbox.addEventListener('close', () => {
      lightbox.classList.remove('is-closing');
      document.documentElement.classList.remove('lightbox-open');
      $$('video', stage).forEach((video) => video.pause());
      stage.replaceChildren();
      current = null;
      statusEl.textContent = '';

      const tile = list[index];
      if (!tile) return;
      tile.focus({ preventScroll: true });
      const box = tile.getBoundingClientRect();
      const bar = $('.filter-bar--sticky');
      const top = bar ? bar.getBoundingClientRect().bottom : 0;
      if (box.top < top || box.bottom > window.innerHeight) tile.scrollIntoView({ block: 'center' });
    });

    lightbox.addEventListener('cancel', (event) => {
      event.preventDefault();
      requestClose();
    });

    document.addEventListener('click', (event) => {
      const tile = event.target.closest('a[data-lightbox]');
      if (!tile || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(tile);
    });

    lightbox.addEventListener('click', (event) => {
      if (swiped) {
        swiped = false;
        return;
      }
      const { target } = event;
      if (target.closest('[data-lightbox-close]')) requestClose();
      else if (target.closest('[data-lightbox-prev]')) step(-1);
      else if (target.closest('[data-lightbox-next]')) step(1);
      else if (target === lightbox || target === stage || target.matches('.lightbox__bar')) requestClose();
    });

    lightbox.addEventListener('keydown', (event) => {
      // Arrow keys belong to the video's own controls while it has focus.
      if (event.target.tagName === 'VIDEO') return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        // The arrow pointing the way the page reads goes forward (left, in Hebrew).
        step((event.key === 'ArrowRight') !== isRtl() ? 1 : -1);
      }
    });

    // Swipe left or right on touch screens (drags that start on a video are left to its scrubber).
    let startX = null;
    let startY = 0;

    stage.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.target.tagName === 'VIDEO') return;
      startX = event.clientX;
      startY = event.clientY;
      swiped = false;
    });

    stage.addEventListener('pointerup', (event) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && list.length > 1) {
        // Swallows the click that follows this pointerup, and only that one.
        swiped = true;
        window.setTimeout(() => { swiped = false; }, 0);
        // Swiping against the reading direction goes forward.
        step((dx < 0) !== isRtl() ? 1 : -1);
      }
    });

    stage.addEventListener('pointercancel', () => { startX = null; });

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => $$('.lightbox__media', stage).forEach(fit)).observe(stage);
    }
  }

  // Category chips in the gallery hero pick that filter, then bring the grid into view.
  $$('[data-gallery-jump]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const button = $(`.filter__btn[data-filter="${link.dataset.galleryJump}"]`);
      const section = document.getElementById(link.hash.slice(1));
      if (!button || !section) return;
      event.preventDefault();
      button.click();
      section.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      button.focus({ preventScroll: true });
      // On phones the filter row scrolls sideways: centre the chosen chip in it.
      const row = button.closest('.filter');
      if (row && row.scrollWidth > row.clientWidth) {
        const b = button.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        row.scrollBy({ left: b.left + b.width / 2 - (r.left + r.width / 2), behavior: scrollBehavior() });
      }
    });
  });

  /* ---------- Placeholder links (social URLs still to come) ---------- */
  $$('a[data-placeholder]').forEach((link) => {
    link.addEventListener('click', (event) => event.preventDefault());
  });

  /* ---------- Footer year ---------- */
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
