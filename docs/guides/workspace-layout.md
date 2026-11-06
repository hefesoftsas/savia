# Workspace layout

On mobile viewports below 640 px, open the assistant with the sparkle icon in
the workspace header beside notifications. Its accessible name remains
"Open assistant" in the active language. The launcher stays outside the scrolling
content so it cannot cover form actions such as Save or Cancel.

At wider viewports, the assistant keeps its labeled floating launcher in the
bottom-right corner. Both presentations open the same conversation panel.

## Mobile actions

Below 640 px, administrative toolbar actions use icons with 44 px touch targets.
Their translated names remain available to screen readers; desktop retains the
visible labels. This applies to shared create, edit, view, save, cancel, delete,
export and sort controls, and to the custom actions in My Day, organization
settings, integrations, account, notifications, access control, credentials,
bookings, Office, Pages and Companion. Navigation tabs, field labels, provider
choices and public form submission buttons keep their visible text.

Studio places its organization selector below the workspace header below 768 px,
so it does not crowd history, notifications or assistant controls. Narrow screen
administration rows use an actions menu beside the visibility switch; recover,
configure and delete actions retain their existing permissions and confirmations.

My Day adds the mail inbox through **Add widget → Personal → Mail inbox**. There
is no separate show-mail shortcut. Removing or adding the inbox preserves other
widgets and saves the layout through the existing preferences service.

Custom toolbars can use `ResponsiveActionButton` when the action has a recognizable
icon. Keep meaningful choice and navigation labels visible rather than applying
the compact treatment to every button.
