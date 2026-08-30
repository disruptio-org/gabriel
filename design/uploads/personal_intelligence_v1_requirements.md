# Personal Intelligence --- V1 Product & UX/UI Requirements

**Document type:** Product / Business / Functional / Technical / UX/UI
Specification\
**Purpose:** Source document for Cloud Design and implementation\
**Version:** 1.0 --- 29 August 2026

------------------------------------------------------------------------

## 1. Product Vision

Personal Intelligence is a private desktop AI companion designed to feel
less like opening a web application and more like **summoning an
intelligent presence**.

The first version is intentionally small. The user clicks one desktop
icon, the assistant appears through a short cinematic animation, greets
the user, and opens a minimal conversational interface powered by the
Claude API.

V1 does **not** connect to email, calendar, company systems, external
databases, or autonomous tools. Its job is to create an exceptional
direct thinking experience between one person and one AI.

### Core idea

> Click. Summon. Think.

The product should communicate intelligence, calm, mystery, speed,
focus, and creativity. It should never feel like a conventional
enterprise chatbot.

------------------------------------------------------------------------

## 2. Business Explanation

### Problem

General AI interfaces are powerful but generic. They are designed for
millions of users, contain many controls, and do not create the feeling
of having a persistent personal intellectual partner immediately
available from the desktop.

### Proposed solution

Create a dedicated desktop application whose sole initial purpose is to
provide instant access to a highly opinionated personal thinking
assistant.

The assistant should:

-   reason from first principles;
-   distinguish facts, assumptions, hypotheses, and opinions;
-   challenge the user's thinking rather than automatically agreeing;
-   explore unconventional alternatives;
-   use relevant intellectual frameworks and documented ideas associated
    with notable thinkers when useful;
-   explain complicated subjects simply;
-   be highly creative without fabricating facts;
-   acknowledge uncertainty;
-   synthesize multiple perspectives;
-   make a recommendation when sufficient information exists.

### V1 success criterion

The product succeeds if the user begins instinctively clicking this
application whenever they want to **think through something**.

The differentiator is therefore not feature quantity. It is the
combination of:

1.  instant availability;
2.  a distinctive personality;
3.  strong reasoning behavior;
4.  exceptional conversational UX;
5.  a memorable visual identity.

------------------------------------------------------------------------

## 3. V1 Scope

### Included

-   Native/lightweight desktop application.
-   Desktop launcher icon.
-   Branded startup/summoning animation.
-   Agent avatar/personification.
-   Greeting sequence.
-   Matrix/terminal-inspired chat experience.
-   Text input.
-   Streaming Claude responses.
-   Markdown rendering for responses.
-   Copy response/action.
-   Stop generation.
-   Regenerate/retry.
-   New conversation.
-   Local conversation history.
-   Basic settings.
-   Secure Claude API configuration.
-   Keyboard-first interaction.
-   Graceful loading, offline, API, and rate-limit states.

### Explicitly excluded from V1

Do not introduce these unless separately approved:

-   email integration;
-   calendar integration;
-   web browsing;
-   file/document RAG;
-   vector databases;
-   company-system integrations;
-   voice;
-   autonomous computer control;
-   multi-agent orchestration;
-   multiple LLM providers;
-   complex workflows;
-   task execution;
-   mobile application;
-   collaboration;
-   enterprise administration.

The architecture may leave clean extension points for these
capabilities, but the UX must not expose unfinished future
functionality.

------------------------------------------------------------------------

# 4. Agent Identity

## 4.1 Working identity: "Ø"

The assistant should initially be represented by the symbol **Ø**.

This is not intended to represent a human, robot, brain, or conventional
AI sparkle icon.

Conceptually, Ø represents:

-   zero assumptions;
-   returning to first principles;
-   an empty starting point;
-   a portal into thought;
-   reduction of complexity;
-   an intelligence without a human face.

The name can later be changed without redesigning the product.

## 4.2 Avatar

The avatar is an **abstract living glyph**, not a face.

Base form:

-   circular ring;
-   diagonal incision/stroke;
-   extremely simple silhouette;
-   recognizable at 16px and at large scale;
-   no gradients required for recognition;
-   no robot head;
-   no humanoid portrait;
-   no brain icon;
-   no stars/sparkles associated with generic AI products.

### Living behavior

The glyph subtly changes state:

**Dormant:** static, faint ring.

**Awakening:** fragments/characters converge to construct the ring.

**Listening/ready:** extremely subtle slow pulse.

**Thinking:** diagonal stroke travels or rotates fractionally while
peripheral characters flicker.

**Streaming:** tiny directional activity moves from glyph toward
response.

**Error:** structure briefly destabilizes/glitches, then reforms. Avoid
aggressive red alarm effects.

------------------------------------------------------------------------

# 5. Visual Design Direction

## 5.1 Design statement

**"A superintelligence hiding inside a 1980s terminal designed by
someone in 2035."**

Use Matrix/command-line references as atmosphere, not as cosplay.

The interface should feel premium, sparse, cinematic, and exceptionally
legible.

## 5.2 Visual principles

1.  **Darkness is the canvas.**
2.  **Typography is the interface.**
3.  **Motion communicates presence.**
4.  **Green is energy, not decoration.**
5.  **Every visible control must earn its place.**
6.  **No dashboard aesthetic.**
7.  **No generic AI gradients.**
8.  **No excessive glassmorphism.**
9.  **No unnecessary cards within cards.**
10. **The conversation is always the hero.**

## 5.3 Suggested palette

Cloud Design may refine exact values while preserving intent.

-   Void / primary background: near-black `#050706`
-   Elevated surface: `#0B0F0C`
-   Primary text: soft off-white `#E8EEE9`
-   Secondary text: muted grey-green `#89958C`
-   Intelligence accent: phosphor green `#69FF94`
-   Dim accent: `#275E38`
-   Border: low-contrast green-grey
-   Error: restrained warm signal rather than saturated warning red

Do not make every piece of text green. Long-form answers should
primarily use soft white for readability.

## 5.4 Typography

Use two complementary families:

**Interface / terminal layer:** premium monospace.

Suggested direction: Geist Mono, IBM Plex Mono, JetBrains Mono, or
equivalent.

**Long answers where readability benefits:** modern neutral sans-serif
such as Inter/Geist.

The visual system may remain entirely monospace if Cloud Design can
maintain excellent long-form readability.

------------------------------------------------------------------------

# 6. Desktop Icon & Launcher

## Icon

The application icon should consist primarily of the Ø living glyph.

At desktop size:

-   near-black rounded-square or transparent/dark container;
-   centered Ø mark;
-   restrained phosphor glow;
-   enough negative space to feel premium.

It must remain recognizable without text.

### Interaction

Single/double click according to OS conventions launches the
application.

Where platform APIs permit, clicking while the app is already running
should bring the existing window to the foreground rather than create
duplicate instances.

------------------------------------------------------------------------

# 7. Opening Experience --- Full Animation Specification

Target total duration: approximately **2.5--4 seconds**.

It must feel special but never become annoying.

After the first few launches, settings should allow: - Full animation -
Reduced animation - Skip animation

## Sequence A --- Invocation \| 0--400ms

The application opens into a small frameless near-black window centered
on the desktop.

For approximately 150--250ms there is almost nothing visible.

A tiny blinking cursor appears:

`_`

Very faint random terminal characters emerge around it.

## Sequence B --- Formation \| 400--1,200ms

Characters begin flowing inward.

They should not reproduce the literal Matrix movie effect. The
inspiration is digital code collapsing into intelligence.

Fragments converge and construct the Ø glyph.

Possible microcopy flashes for only fractions of a second:

`INITIALIZING` `CONTEXT: READY` `REASONING: ONLINE`

These should be subtle enough that users may discover them over repeated
launches.

## Sequence C --- Awakening \| 1,200--1,700ms

Ø completes.

A soft pulse travels outward.

No loud sound is required in V1. Default should be silent.

The glyph moves slightly upward to make space for text.

## Sequence D --- Greeting \| 1,700--2,600ms

Text types naturally:

`Hello, Iago.`

Pause approximately 250ms.

Then:

`What are we thinking about?`

A cursor blinks underneath.

## Sequence E --- Transformation \| 2,600--3,400ms

Instead of navigating to another screen, the greeting environment
**becomes the chat**.

The window smoothly expands to its normal size.

The greeting moves/fades into the conversation area.

The input line materializes at the bottom.

Focus automatically moves to the text field.

The user can immediately type.

### Important motion rule

Never block fast users. If the user starts typing or presses a
designated skip key during the animation, accelerate directly to the
ready state.

------------------------------------------------------------------------

# 8. Main Chat Interface

## Window

Recommended default: - centered; - approximately 900--1100px wide; -
approximately 70--80% of screen height; - resizable; - remembers
previous size/position; - minimum size defined to preserve readability.

Prefer a custom/minimal title bar while preserving expected OS
behaviors: drag, minimize, maximize, close, resize.

## Top bar

Extremely restrained:

`Ø   PERSONAL INTELLIGENCE`

Right side: - New conversation - History - Settings - Minimize - Close

Icons should appear subtly and may become clearer on hover.

## Conversation area

Maximum readable text width should be constrained even when the window
is wide.

### User messages

Avoid large speech bubbles.

Use:

`YOU`

followed by the user's text.

### Assistant messages

Use the Ø glyph or `Ø`.

The response streams progressively.

Example:

``` text
YOU
Should I accept this business opportunity?

Ø
Let's separate the opportunity from the excitement.

The decision depends on four underlying questions...
```

This creates the feeling of a transcript between two minds rather than a
messaging app.

## Input composer

Bottom-anchored.

Placeholder:

`Ask anything...`

or preferably:

`What are we thinking about?`

Behavior: - Enter = send - Shift+Enter = new line - Esc = stop
generation when active - autofocus after launch - automatically expands
for multiline prompts - maximum expansion height before internal
scrolling

Avoid a large bright Send button. A small arrow/return symbol is
sufficient.

------------------------------------------------------------------------

# 9. Thinking & Response Animation

When Claude is processing, do not use a conventional spinner.

Ø should enter **thinking state**.

Below it, optionally cycle understated states such as:

`thinking` `examining assumptions` `considering alternatives`

These labels must not claim to expose hidden chain-of-thought. They are
interface status language only.

Once the first token arrives, the status disappears and the answer
streams.

Cursor behavior:

`█`

or

`_`

at the end of streaming text.

Animation must remain smooth even during long responses.

------------------------------------------------------------------------

# 10. Interaction Details

## Response actions

On hover/end of response: - Copy - Regenerate - optional thumbs feedback
later

Keep actions hidden/subdued until needed.

## New conversation

Keyboard shortcut: - macOS: `Cmd + N` - Windows/Linux: `Ctrl + N`

A new conversation should be instantaneous.

## History

History is secondary, not a permanent sidebar.

Open it as a slim overlay/drawer or command-palette-like layer.

Each item: - generated title; - relative/absolute date; - short preview.

Search can be added if implementation is trivial, otherwise defer.

## Settings

Small modal/panel containing only V1 necessities:

**AI** - Claude model - API connection status

**Appearance** - animation: Full / Reduced / Off - text size - optional
UI scale

**Data** - conversation history location - clear local history

**About** - version

Do not turn Settings into an administration console.

------------------------------------------------------------------------

# 11. Empty, Loading & Error States

All states must preserve the agent personality.

### API key not configured

`Ø needs a Claude connection.`

Provide a direct route to Settings.

### Connection failure

`I couldn't reach Claude.`

Show Retry and a concise technical detail disclosure.

### Rate limit

Explain that the provider is temporarily limiting requests and offer
retry.

### Generation stopped

Keep partial output and mark unobtrusively:

`Generation stopped.`

### No internet

Clearly distinguish local application availability from Claude API
availability.

Never fabricate an answer when the provider cannot be reached.

------------------------------------------------------------------------

# 12. Functional Requirements

## FR-01 Application launch

The user can launch the application from a desktop/application icon.

## FR-02 Single active experience

Launching an already-running instance should foreground it where
technically practical.

## FR-03 Startup sequence

The application performs the configured greeting animation and
transitions directly into chat.

## FR-04 Prompt submission

The user can submit plain-text and multiline prompts.

## FR-05 Claude request

The application sends the conversation context and system instructions
to the configured Claude API/model.

## FR-06 Streaming

Responses must stream into the interface as they arrive.

## FR-07 Conversation context

Messages within a conversation are provided as appropriate context for
subsequent messages.

## FR-08 Local history

Conversation metadata/messages are stored locally and can be reopened.

## FR-09 New conversation

The user can create a clean conversation.

## FR-10 Stop

The user can stop an active generation.

## FR-11 Regenerate

The user can retry the latest assistant response.

## FR-12 Copy

Assistant responses can be copied.

## FR-13 Markdown

Render common Markdown safely: headings, emphasis, lists, links, tables,
quotes, inline code, and code blocks.

## FR-14 Code

Code blocks provide legible formatting and copy functionality.

## FR-15 Settings

The user can manage V1 preferences and Claude connection configuration.

## FR-16 State persistence

Window dimensions, position, and appearance preferences persist locally.

------------------------------------------------------------------------

# 13. Agent Behavioral Requirements

The system prompt/agent configuration should establish behavior, not
theatrical impersonation.

The agent should:

1.  Determine what the user is actually trying to accomplish.
2.  Identify important missing information.
3.  Separate known facts from assumptions.
4.  Reduce difficult questions to fundamentals where beneficial.
5.  Generate multiple hypotheses/approaches before prematurely
    converging.
6.  Challenge obvious or emotionally attractive conclusions.
7.  Look for second-order effects.
8.  Consider opportunity cost.
9.  Seek disconfirming evidence.
10. Prefer simple explanations.
11. Be imaginative and unconventional where useful.
12. Never invent facts to make an idea more interesting.
13. Clearly communicate uncertainty.
14. Give concrete recommendations when justified.
15. Ask focused questions when missing information materially changes
    the answer.

### Intellectual models

The agent may apply documented concepts associated with thinkers such as
Warren Buffett, Charlie Munger, Steve Jobs, Albert Einstein, Richard
Feynman, Charles Darwin, and others.

It should use the **idea**, not role-play the person.

Bad: `Steve Jobs would definitely tell you to...`

Better:
`A useful product-focus lens here is subtraction: which 80% can be removed without destroying the core value?`

This intellectual-framework library can initially live inside curated
system instructions/configuration rather than requiring RAG.

------------------------------------------------------------------------

# 14. Conceptual Reasoning Architecture

``` text
USER
  │
  ▼
UNDERSTAND INTENT
  │
  ▼
DECOMPOSE PROBLEM
  │
  ├──────────────┬────────────────┐
  ▼              ▼                ▼
FIRST          MENTAL           CREATIVE
PRINCIPLES     MODELS           EXPLORATION
  │              │                │
  └──────────────┴────────────────┘
                 │
                 ▼
             SYNTHESIZE
                 │
                 ▼
          CHALLENGE / VERIFY
                 │
                 ▼
               ANSWER
```

This is primarily an **agent behavior design**, not a requirement to
make seven separate API calls. V1 should prefer one well-designed Claude
interaction over expensive orchestration unless evaluation proves
additional calls materially improve quality.

------------------------------------------------------------------------

# 15. Technical Architecture

## Recommended stack

### Desktop shell

**Tauri 2**

Reasons: - lightweight; - native desktop packaging; - smaller footprint
than typical Electron applications; - good fit for a focused desktop
utility; - web technology can power sophisticated UI animation.

Electron remains acceptable if team velocity or library compatibility
strongly favors it.

### Frontend

-   React
-   TypeScript
-   modern CSS/Tailwind or equivalent
-   Framer Motion or performant native CSS animation where appropriate
-   Markdown renderer with sanitization
-   syntax highlighting

### AI provider

Claude API only for V1.

Use Anthropic's supported SDK/API approach appropriate to the
implementation language.

### Local persistence

Prefer a simple local SQLite database or equivalent robust local store.

Suggested conceptual entities:

``` text
Conversation
- id
- title
- created_at
- updated_at

Message
- id
- conversation_id
- role
- content
- created_at
- provider
- model

Setting
- key
- value
```

Avoid a vector database in V1.

------------------------------------------------------------------------

# 16. API & Security Requirements

## Critical rule

**Never hard-code or commit the Claude API key into source control.**

For a personal local desktop application, store credentials using the
operating system's secure credential/keychain mechanism where possible.

Examples conceptually: - macOS Keychain - Windows Credential Manager -
Linux Secret Service/keyring

The UI may allow the user to enter/update the credential, but should
never display the full key after storage.

## Request architecture

``` text
Desktop UI
    │
    ▼
Local Application Service
    │
    ├── Conversation manager
    ├── Agent/system configuration
    ├── Local persistence
    └── Claude client
              │
              ▼
          Claude API
```

Do not expose the provider key through browser-accessible logs or client
debugging output unnecessarily.

## Logging

Logs may contain: - timestamps; - request duration; - model; - status; -
token/usage metadata when available; - errors.

Avoid logging full private prompts/responses by default.

------------------------------------------------------------------------

# 17. Performance Requirements

The application should feel instantaneous even though the model is
remote.

Targets:

-   application shell visible quickly after launch;
-   animation remains at smooth frame rate;
-   input available immediately after/while animation resolves;
-   prompt submission provides visual acknowledgement within \~100ms;
-   Claude streaming displayed as soon as first output arrives;
-   history opening should feel immediate for normal personal usage.

Never artificially delay a Claude response to complete an animation.

------------------------------------------------------------------------

# 18. Accessibility & Motion

Even though the product is cinematic:

-   respect OS reduced-motion preference;
-   offer Reduced/Off animation setting;
-   maintain WCAG-conscious text contrast;
-   full keyboard operation;
-   visible focus states consistent with visual language;
-   do not rely on green alone to communicate state;
-   text size must remain usable;
-   animation must not contain rapid high-intensity flashing.

------------------------------------------------------------------------

# 19. Responsive Desktop Behavior

Design for: - laptop displays; - external monitors; -
Windows/macOS/Linux window resizing where supported.

At narrow widths: - preserve conversation readability; - collapse
nonessential labels into icons; - never horizontally clip code
unnecessarily; - keep composer usable.

This is desktop-first. Do not compromise V1 desktop quality to create a
mobile layout.

------------------------------------------------------------------------

# 20. Cloud Design Deliverables Requested

Cloud Design should produce:

1.  Application icon exploration centered on Ø.
2.  Final desktop icon.
3.  Agent glyph/avatar states:
    -   dormant;
    -   awakening;
    -   ready;
    -   thinking;
    -   streaming;
    -   error.
4.  Startup animation storyboard with keyframes/timings.
5.  Greeting state.
6.  Main empty chat state.
7.  Active conversation state.
8.  Long-response state.
9.  Code-response state.
10. Thinking/loading state.
11. History overlay.
12. Settings panel.
13. API-key setup state.
14. Error/offline states.
15. Reduced-motion equivalent.
16. Window resizing examples.
17. Interaction/motion specifications suitable for implementation.
18. Design tokens for typography, spacing, borders, surfaces, and
    animation.
19. Hover/focus/pressed states.
20. Developer-ready component specification.

------------------------------------------------------------------------

# 21. Cloud Design Creative Instruction

Do **not** interpret "Matrix" as a request to copy the Matrix
franchise's visual assets.

Take inspiration from: - terminal interfaces; - phosphor displays; -
streams of information; - code; - darkness; - digital emergence; -
minimal science-fiction interfaces.

Then reduce those references into an original premium visual language.

The final result should feel like a **personal intelligence
instrument**, not: - a hacker dashboard; - a gaming UI; - ChatGPT with
green colors; - a crypto terminal; - a corporate SaaS dashboard; - a
humanoid AI assistant.

------------------------------------------------------------------------

# 22. Primary User Journey

``` text
DESKTOP
   │
   │ click Ø
   ▼
BLACK WINDOW
   │
   │ digital fragments converge
   ▼
Ø AWAKENS
   │
   ▼
"Hello, Iago."
   │
   ▼
"What are we thinking about?"
   │
   │ user types
   ▼
PROMPT
   │
   ▼
Ø THINKING
   │
   ▼
CLAUDE STREAMS RESPONSE
   │
   ▼
CONVERSATION CONTINUES
```

There should be almost no friction between the first and last states.

------------------------------------------------------------------------

# 23. V1 Product Principle

When making a design or engineering decision, use this hierarchy:

**Does it improve the thinking experience?**

If yes, consider it.

If it merely makes the application look more feature-rich, defer it.

V1 should be small enough that its identity is obvious:

> **A button on your computer that summons an exceptional mind.**

------------------------------------------------------------------------

# 24. Future Direction --- Not V1 Requirements

The architecture may later evolve toward:

``` text
V1                    FUTURE
Claude                Multiple models
Text chat             Voice
Local history         Long-term memory
No tools              Web research
No integrations       Files / email / calendar
Conversation          Actions
Single assistant      Specialist capabilities
Desktop               Cross-device
```

These future possibilities must **not** add visible complexity to V1.

------------------------------------------------------------------------

# 25. Definition of Done for V1

V1 is ready when:

-   the desktop app installs and launches reliably;
-   Ø has a polished recognizable icon;
-   opening animation is implemented and skippable;
-   greeting transitions naturally into chat;
-   Claude API connection works securely;
-   responses stream;
-   multi-turn conversation context works;
-   Markdown/code render correctly;
-   stop/copy/regenerate/new-chat work;
-   history persists locally;
-   essential settings work;
-   failure states are understandable;
-   reduced motion is supported;
-   no excluded integrations have crept into the interface;
-   the entire product feels like one coherent personal intelligence
    experience.

**The emotional test:** clicking Ø should feel closer to calling an
extraordinarily capable adviser into the room than opening another piece
of software.
