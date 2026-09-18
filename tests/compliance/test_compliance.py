from __future__ import annotations

from datetime import UTC, datetime, timedelta

from coach_ai.compliance import block_features, session_compliance, split_blocks
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

START = datetime(2026, 1, 5, 18, 0, tzinfo=UTC)


def make_set(reps: int, load: float, *, completed: bool = True, effort: float | None = None,
             scale: str = "rpe", warmup: bool = False) -> StrengthSet:
    meta: dict = {"completed": completed}
    if effort is not None:
        meta["effort_scale"] = scale
        meta["effort_value"] = effort
    return StrengthSet(reps=reps, load_kg=load, is_warmup=warmup, meta=meta)


def make_session(
    *,
    when: datetime = START,
    sets: list[StrengthSet] | None = None,
    target: tuple[int, int] | None = (8, 12),
    group: str | None = "Pecho",
    wellness: tuple[float, float, float] | None = None,
) -> Session:
    meta: dict = {}
    if target:
        meta["target_reps_min"], meta["target_reps_max"] = target
    if group:
        meta["group"] = group

    session_meta: dict = {}
    if wellness:
        sleep, stress, sensations = wellness
        session_meta["wellness_signals"] = {
            "sleep": {"score_1_10": sleep},
            "stress": {"score_1_10": stress},
            "sensations": {"score_1_10": sensations},
        }

    return Session(
        athlete_id="user_1",
        start_time=when,
        duration_min=60,
        exercises=[
            StrengthExercise(
                name="Press banca",
                sets=sets if sets is not None else [make_set(10, 60.0)],
                meta=meta,
            )
        ],
        meta=session_meta,
    )


def test_counts_completed_sets_against_prescribed_ones():
    session = make_session(
        sets=[make_set(10, 60.0), make_set(10, 60.0), make_set(0, 0.0, completed=False)]
    )
    compliance = session_compliance(session)

    assert compliance.sets_prescribed == 3
    assert compliance.sets_completed == 2
    assert compliance.set_completion_ratio == 2 / 3


def test_reps_in_target_uses_the_routine_target():
    session = make_session(
        target=(8, 12),
        sets=[make_set(10, 60.0), make_set(6, 60.0), make_set(12, 60.0)],
    )
    exercise = session_compliance(session).exercises[0]

    assert exercise.reps_in_target == 2  # 10 y 12 entran, 6 no
    assert exercise.reps_in_target_ratio == 2 / 3


def test_without_prescription_there_is_no_target_ratio():
    session = make_session(target=None, sets=[make_set(10, 60.0)])
    compliance = session_compliance(session)

    assert compliance.has_prescription is False
    assert compliance.exercises[0].reps_in_target == 0


def test_warmups_do_not_count_as_dose():
    session = make_session(sets=[make_set(12, 20.0, warmup=True), make_set(10, 60.0)])
    exercise = session_compliance(session).exercises[0]

    assert exercise.sets_prescribed == 1
    assert exercise.sets_completed == 1
    assert exercise.volume_load_kg == 600.0


def test_rir_is_converted_to_rpe():
    session = make_session(
        sets=[make_set(10, 60.0, effort=2, scale="rir"), make_set(10, 60.0, effort=1, scale="rir")]
    )
    exercise = session_compliance(session).exercises[0]

    assert exercise.mean_effort_rpe == 8.5  # (10-2 y 10-1) promediados


def test_sets_without_completed_flag_count_as_done():
    """Sesiones importadas no traen el flag; asumirlas fallidas daria 0% siempre."""
    session = Session(
        athlete_id="user_1",
        start_time=START,
        duration_min=60,
        exercises=[
            StrengthExercise(name="Sentadilla", sets=[StrengthSet(reps=5, load_kg=100.0)])
        ],
    )
    compliance = session_compliance(session)

    assert compliance.sets_completed == 1
    assert compliance.set_completion_ratio == 1.0


def test_wellness_is_read_from_session_meta():
    session = make_session(wellness=(7.0, 4.0, 6.5))
    compliance = session_compliance(session)

    assert compliance.sleep_1_10 == 7.0
    assert compliance.stress_1_10 == 4.0
    assert compliance.sensations_1_10 == 6.5


def test_block_aggregates_dose_per_week_and_compliance():
    sessions = [
        make_session(
            when=START + timedelta(days=day),
            sets=[make_set(10, 60.0), make_set(10, 60.0), make_set(0, 0.0, completed=False)],
            wellness=(7.0, 5.0, 7.0),
        )
        for day in (0, 7, 14, 21)
    ]
    block = block_features(sessions, START, START + timedelta(days=28), sessions_planned=8)

    assert block is not None
    assert block.sessions_done == 4
    assert block.weeks == 4.0
    assert block.sessions_per_week == 1.0
    assert block.hard_sets_per_week == 2.0  # 2 series completadas por sesion, 4 semanas
    assert block.hard_sets_per_week_by_group == {"Pecho": 2.0}
    assert block.set_completion_ratio == 8 / 12
    assert block.reps_in_target_ratio == 1.0
    assert block.session_adherence == 0.5
    assert block.mean_sleep_1_10 == 7.0
    assert block.sessions_with_prescription == 4


def test_block_without_sessions_is_none():
    assert block_features([], START, START + timedelta(days=28)) is None


def test_split_blocks_covers_the_history():
    sessions = [make_session(when=START + timedelta(days=day)) for day in (0, 30, 65)]
    blocks = split_blocks(sessions, block_days=28)

    assert len(blocks) == 3
    assert blocks[0][0] == START
    assert blocks[1][0] == START + timedelta(days=28)
    assert blocks[-1][1] > sessions[-1].start_time
