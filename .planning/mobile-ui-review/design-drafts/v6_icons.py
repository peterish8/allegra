"""Design glyphs mapped to the Ionicons family already shipped by the app."""
import json
from pathlib import Path
from html import escape

GLYPHS = json.loads((Path(__file__).parent / 'assets' / 'ionicons-glyphs.json').read_text(encoding='utf-8'))
NAMES = dict(
    account_circle='person-circle', add='add', arrow_back='arrow-back', auto_stories='book',
    backspace='backspace', battery_full='battery-full', bedtime='moon', bolt='flash', bookmarks='bookmarks',
    cast='tv', check='checkmark', check_box='checkbox', check_box_outline_blank='square',
    check_circle='checkmark-circle', chevron_right='chevron-forward', close='close', cloud='cloud',
    cloud_download='cloud-download', cloud_off='cloud-offline', coffee='cafe', computer='desktop',
    content_copy='copy', content_paste='clipboard', delete='trash', devices='desktop', download='download',
    download_done='checkmark-done', drag_indicator='reorder-two', edit='pencil', edit_note='create',
    equalizer='options', error='alert-circle', expand_more='chevron-down', fast_forward='play-forward',
    fast_rewind='play-back', favorite='heart', fullscreen='expand', graphic_eq='musical-notes',
    grid_view='grid', group='people', help='help-circle', hide_image='image', history='time', image='image',
    info='information-circle', join='git-merge', key_off='key', keyboard_arrow_down='chevron-down',
    keyboard_capslock='arrow-up', language='language', library_music='library', lyrics='chatbox-ellipses',
    merge='git-merge', mic='mic', more_horiz='ellipsis-horizontal', more_vert='ellipsis-vertical',
    move_to_inbox='file-tray', music_note='musical-note', notifications='notifications', open_in_new='open',
    pause='pause', person='person', person_add='person-add', photo_camera='camera', photo_library='images',
    play_arrow='play', play_circle='play-circle', playlist_add='list', playlist_remove='remove-circle',
    queue_music='list', queue_play_next='return-down-forward', radio='radio', radio_button_unchecked='ellipse',
    refresh='refresh', remove='remove', reorder='reorder-three', repeat_one='repeat', search='search',
    search_off='search', send='send', settings='settings', share='share-social', shield='shield-checkmark',
    shuffle='shuffle', signal_cellular_alt='cellular', skip_next='play-skip-forward', smartphone='phone-portrait',
    swap_vert='swap-vertical', sync_problem='sync', timer='timer', timer_off='timer', translate='language',
    travel_explore='compass', tune='options', visibility='eye', visibility_off='eye-off', wifi='wifi',
)


def ic(name, fill=False, size=None, color=None, cls=''):
    base = NAMES[name]  # fail generation rather than silently drawing a missing glyph
    glyph = base if fill or base + '-outline' not in GLYPHS else base + '-outline'
    style = ';'.join(([f'font-size:{size}px'] if size else []) + ([f'color:{color}'] if color else []))
    return f'<span class="ms{" f" if fill else ""}{" " + cls if cls else ""}" aria-hidden="true" data-ionicon="{glyph}" style="{escape(style)}">&#{GLYPHS[glyph]};</span>'
