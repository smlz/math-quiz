# Sound credits

The host screen plays these clips (see `src/sound/hostSound.ts`): one of the
`music-*` tunes per quiz (in random order, each once before any repeats),
one of the `cheer-*` clips per leaderboard (at random), and the applause at
the end.

All sources but one are dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); for those, no
attribution is required, it is given here as a courtesy and so the originals
can be found again. “C64 Happy Loop” is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), which requires the
attribution below; the app's footer links to this file for it.

Each clip was levelled with ffmpeg (music to −18 LUFS, cheers to −22 LUFS,
the applause to −14 LUFS) and encoded as 128 kbit/s MP3; nothing else was
changed except as noted.

## Music

| File | Original | Author | License | Source |
|------|----------|--------|---------|--------|
| `music-happy-vibes.mp3` | “Happy Vibes” | Ruskerdax | CC0 | [OpenGameArt](https://opengameart.org/node/160228) |
| `music-happy-beat.mp3` | “Happy Beat” | burabotti | CC0 | [OpenGameArt](https://opengameart.org/content/happy-beat) |
| `music-happy-adventure.mp3` | “Happy Adventure (Loop)” | TinyWorlds | CC0 | [OpenGameArt](https://opengameart.org/content/happy-adventure-loop) |
| `music-c64-happy-loop.mp3` | “C64 Happy Loop”, ©2017 Emma Andersson (Emma_MA) | Emma_MA | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [OpenGameArt](https://opengameart.org/node/167453) |

“C64 Happy Loop” by Emma Andersson (Emma_MA), licensed under CC BY 4.0;
changed in volume and converted to MP3.

## Cheers

| File | Original | Author | License | Source |
|------|----------|--------|---------|--------|
| `cheer-woohoo.mp3` | “Applause #3” (one person clapping) | Joseph Sardin | CC0 | [BigSoundBank #1767](https://bigsoundbank.com/applause-3-s1767.html) |
| | “Applause #2” (one person clapping) | Joseph Sardin | CC0 | [BigSoundBank #1766](https://bigsoundbank.com/applause-2-s1766.html) |
| | “MaleVoiceWoohoo.wav” | melisandepope | CC0 | [Freesound #557125](https://freesound.org/people/melisandepope/sounds/557125/) |
| | “Joyful - Wouhouh” | Sadiquecat | CC0 | [Freesound #801291](https://freesound.org/people/Sadiquecat/sounds/801291/) |
| `cheer-class.mp3` | “Clapping.mp3” | Camo1018 | CC0 | [Freesound #425663](https://freesound.org/people/Camo1018/sounds/425663/) |
| `cheer-small-crowd.mp3` | “Crowd Clapping 1_1” | Joao_Janz | CC0 | [Freesound #482656](https://freesound.org/people/Joao_Janz/sounds/482656/) |

`cheer-woohoo.mp3` is a mix: 4.5 s of two people clapping, one panned a
little to each side, with the two voices coming in at 0.25 s and 1.4 s, and
a fade-out.
`cheer-class.mp3` has a 0.5 s fade-out at its very end.

## Applause

| File | Original | Author | License | Source |
|------|----------|--------|---------|--------|
| `final-applause.mp3` | “Crowd Cheer” | FoolBoyMedia | CC0 | [Freesound #397434](https://freesound.org/people/FoolBoyMedia/sounds/397434/) |

It has a 2 s fade-out at its end; the 2.5 s fade-in, as the music fades out,
is done in code.
