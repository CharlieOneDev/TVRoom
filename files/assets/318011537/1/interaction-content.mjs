// Content is intentionally kept separate from interaction and UI code so that
// entries can later be generated from JSON without changing the renderer.
import { getLanguage } from './localization.mjs';
import { NOTEBOOK_TRANSLATIONS } from './interaction-content-translations.mjs';

export const INTERACTION_CONTENT = Object.freeze({
    investigation_notebook: Object.freeze({
        id: 'investigation_notebook',
        type: 'notebook',
        title: 'A Note for Willard',
        date: 'Monday, October 17',
        distance: 2,
        pages: Object.freeze([
            Object.freeze({
                title: 'My Dear Willard,',
                body: `I hope the crossing wasn't too rough. Put the kettle on before you unpack; everything else can wait.

I've arranged the lighthouse keeper's post for you, just as we discussed. A little work, a room of your own, and all the quiet you could wish for. There is no need to hurry here. Rest, settle into your books, and take your studies at your own pace.

No one will come knocking or ask anything more of you for a while. Think of this place as a small corner of the world you are allowed to keep to yourself.`
            }),
            Object.freeze({
                title: 'Make Yourself at Home',
                body: `The island's internet is connected and working, so you needn't worry about being cut off. It does rely on a satellite, though, and it rains here every day. The signal can be rather temperamental under all those clouds. Give it a little time if a page refuses to load.

And when your eyes have had enough of books, put your feet up and watch some television. A cup of something warm and an old film make very good company on a wet evening.

I hope you come to love this little island, Willard. Eat properly, keep warm, and let yourself enjoy the peace. You don't have to earn every moment of rest.

With all my love,
Your Aunt`
            })
        ])
    })
});

export function getInteractionContent(id) {
    const base = INTERACTION_CONTENT[id];
    if (!base) return null;
    const translated = id === 'investigation_notebook' ? NOTEBOOK_TRANSLATIONS[getLanguage()] : null;
    return translated ? { ...base, ...translated } : base;
}
