
## UI Screens

### Screen 1 — Feed (anonymous)
```
┌──────────────────────────────┐
│ 9:41                    |||  │
├──────────────────────────────┤
│  Feed                   [+] │
├──────────────────────────────┤
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          2h ago │  │
│  │ Just saw the most      │  │
│  │ beautiful sunset from  │  │
│  │ the park today...      │  │
│  │                        │  │
│  │ <3 12   ~ 3   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          5h ago │  │
│  │ Anyone feel like       │  │
│  │ everything is moving   │  │
│  │ too fast lately?       │  │
│  │                        │  │
│  │ <3 8    ~ 5   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ # anon          1d ago │  │
│  │ Got the job!! Finally. │  │
│  │                        │  │
│  │ <3 31   ~ 7   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│ [Feed]  Chats  Friends   Me  │
└──────────────────────────────┘
```
- `[+]` opens compose sheet (anonymous post)
- `<3` = like, `~` = resonates
- `[Reach]` triggers the anon contact modal

---

### Screen 2 — Reach out modal
```
┌──────────────────────────────┐
│  Feed                   [+] │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ # anon  · Got the job! │  │
│  │ <3 31   ~ 7   [Reach]  │  │
│  └────────────────────────┘  │
│                              │
│  ╔════════════════════════╗  │
│  ║  Reach anonymously?    ║  │
│  ║                        ║  │
│  ║  They won't know it's  ║  │
│  ║  you. A thread opens   ║  │
│  ║  only if they reply.   ║  │
│  ║                        ║  │
│  ║  ┌────────────────┐    ║  │
│  ║  │ Your post made │    ║  │
│  ║  │ me smile today │    ║  │
│  ║  └────────────────┘    ║  │
│  ║                        ║  │
│  ║  [Cancel]    [Send >]  ║  │
│  ╚════════════════════════╝  │
└──────────────────────────────┘
```
- Thread only appears in Chats if the author replies
- Fire-and-forget if author ignores

---

### Screen 3 — Anonymous thread
```
┌──────────────────────────────┐
│  <  Anonymous thread    [i]  │
│     re: "got the job" post   │
├──────────────────────────────┤
│  -- both identities hidden --│
│                              │
│            ┌───────────────┐ │
│            │ Your post     │ │
│            │ made me smile │ │
│            └───────────────┘ │
│                  you · 10:32 │
│  ┌────────────────────┐      │
│  │ Thank you! I was   │      │
│  │ nervous for months │      │
│  └────────────────────┘      │
│  them · 10:45                │
│  ┌────────────────────────┐  │
│  │  [Reveal your name?]   │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│ ┌──────────────────────┐ [>] │
│ │ Type a message...    │     │
│ └──────────────────────┘     │
└──────────────────────────────┘
```
- `[Reveal your name?]` is soft — either side initiates, both must agree

---

### Screen 4 — Chats list
```
┌──────────────────────────────┐
│  Chats                       │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ [A] Alice              │  │
│  │     hey are you free   │  │
│  │     tomorrow?     2m   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ [B] Bob            (3) │  │
│  │     ok sounds good 1h  │  │
│  └────────────────────────┘  │
│                              │
│  -- Anonymous threads --     │
│                              │
│  ┌────────────────────────┐  │
│  │ [?] "got the job" post │  │
│  │     You deserve it :)  │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│  Feed  [Chats] Friends   Me  │
└──────────────────────────────┘
```

---

### Screen 5 — Add Friend (QR)
```
┌──────────────────────────────┐
│  <  Add Friend               │
├──────────────────────────────┤
│  [ My QR code ] [ Scan QR ] │
│  ──────────────────────────  │
│   Show this to your friend:  │
│   ┌──────────────────────┐   │
│   │ ▓▓▓  ░▓░▓░░  ░  ▓▓▓ │   │
│   │ ▓ ▓  ▓░░░░▓  ░  ▓ ▓ │   │
│   │ ▓▓▓  ░▓░░░▓  ░  ▓▓▓ │   │
│   └──────────────────────┘   │
│   Your ID:  a3f9...c7b2      │
│   [       Copy ID          ] │
├──────────────────────────────┤
│  Feed   Chats [Friends]  Me  │
└──────────────────────────────┘
```
