# The default `create-expo-app` template fails `tsc --noEmit` on `TabTriggerSlotProps`'s `ref`

A new `npx create-expo-app@latest` project (SDK 58, npm). Every file `tsc` reads is as `create-expo-app` wrote it.

1. `npm install`
2. `npx expo customize tsconfig.json`. It writes `expo-env.d.ts` (`/// <reference types="expo/types" />`), as `npx expo start` does when typed routes are on.
3. `npx tsc --noEmit`

Expected: no error. Seen, in the template's own [`src/components/app-tabs.web.tsx`](src/components/app-tabs.web.tsx), where `TabButton` spreads `TabTriggerSlotProps` onto a `Pressable`:

```
src/components/app-tabs.web.tsx(38,6): error TS2322: Type '{ children: Element; style: ({ pressed }: PressableStateCallbackType) => false | { opacity: number; }; pointerEvents?: "auto" | "box-none" | "box-only" | "none" | undefined; ... 130 more ...; href?: string | undefined; }' is not assignable to type '{ ref?: Ref<ReactNativeElement> | undefined; }'.
```

`node repro.mjs` runs the three steps, checks that `TabTriggerSlotProps` and `app-tabs.web.tsx` on expo's `main` are the ones installed here, and exits 1 while the error shows, 0 when it is gone, and 2 when a step fails, `tsc` reports another error or `main` has changed either. `node repro.mjs --tab-trigger <path>` runs them with another `expo-router/build/ui/TabTrigger.d.ts` in place of the installed one.
