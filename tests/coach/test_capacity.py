from __future__ import annotations

import re

from app.coach.capacity import CoachCapacity, generate_invite_code


def test_generate_invite_code_format():
    code = generate_invite_code()
    assert re.fullmatch(r"[A-Z2-9]{4}-[A-Z2-9]{4}", code)


def test_generate_invite_code_avoids_ambiguous_chars():
    for _ in range(200):
        code = generate_invite_code()
        assert not set(code) & set("0O1I")


def test_generate_invite_code_is_random():
    codes = {generate_invite_code() for _ in range(50)}
    assert len(codes) == 50


def test_capacity_has_room_when_below_total():
    capacity = CoachCapacity(used=3, included=15, extra=0, total=15)
    assert capacity.has_room


def test_capacity_no_room_when_at_total():
    capacity = CoachCapacity(used=15, included=15, extra=0, total=15)
    assert not capacity.has_room


def test_capacity_extra_seats_increase_room():
    capacity = CoachCapacity(used=15, included=15, extra=2, total=17)
    assert capacity.has_room
