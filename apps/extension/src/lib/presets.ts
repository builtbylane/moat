export interface Preset {
  name: string;
  hosts: readonly string[];
}

export const PRESETS: readonly Preset[] = [
  {
    name: 'Social',
    hosts: [
      'facebook.com',
      'instagram.com',
      'x.com',
      'twitter.com',
      'tiktok.com',
      'reddit.com',
      'snapchat.com',
      'threads.net',
    ],
  },
  {
    name: 'News',
    hosts: [
      'cnn.com',
      'foxnews.com',
      'nytimes.com',
      'bbc.com',
      'news.ycombinator.com',
      'news.google.com',
    ],
  },
  {
    name: 'Video',
    hosts: ['youtube.com', 'netflix.com', 'hulu.com', 'twitch.tv', 'disneyplus.com', 'vimeo.com'],
  },
];
