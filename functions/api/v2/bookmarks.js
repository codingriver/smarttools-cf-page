import { handleBookmarks } from '../../_shared/bookmarks-v2.js';
export const onRequest = context => handleBookmarks(context);
