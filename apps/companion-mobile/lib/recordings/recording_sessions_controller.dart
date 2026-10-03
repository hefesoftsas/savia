import 'dart:async';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'session_models.dart';

typedef ListRecordingSessions = Future<RecordingSessionPage> Function({
  String? cursor,
});
typedef GetRecordingSession = Future<RecordingSession> Function(String id);
typedef ProcessRecordingSession = Future<RecordingSession> Function(
  String id, {
  required bool consent,
  required bool retryAmbiguous,
});
typedef CancelRecordingSession = Future<RecordingSession> Function(String id);
typedef AskRecordingSession = Future<SessionAnswer> Function(
  String id,
  String question, {
  required bool consent,
});
typedef SessionPollTimerFactory = Timer Function(
  Duration duration,
  void Function() callback,
);

class RecordingSessionsController extends ChangeNotifier {
  RecordingSessionsController({
    required this.list,
    required this.get,
    required ProcessRecordingSession process,
    required this.cancel,
    required this.answer,
    this.timerFactory = _periodicTimer,
    this.pollingInterval = const Duration(seconds: 3),
  }) : processor = process;

  final ListRecordingSessions list;
  final GetRecordingSession get;
  final ProcessRecordingSession processor;
  final CancelRecordingSession cancel;
  final AskRecordingSession answer;
  final SessionPollTimerFactory timerFactory;
  final Duration pollingInterval;

  List<RecordingSession> sessions = [];
  String? cursor;
  String? selectedId;
  RecordingSession? selectedSession;
  SessionAnswer? lastAnswer;
  CompanionFailure? failure;
  bool loading = false;
  bool detailLoading = false;
  bool processing = false;
  bool asking = false;
  bool _disposed = false;
  int _generation = 0;
  int _selection = 0;
  Timer? _pollTimer;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> reload({bool more = false}) async {
    if (loading || (more && cursor == null)) return;
    final generation = _generation;
    loading = true;
    failure = null;
    _notify();
    try {
      final page = await list(cursor: more ? cursor : null);
      if (generation != _generation) return;
      sessions = more ? [...sessions, ...page.sessions] : page.sessions;
      cursor = page.cursor;
    } catch (error) {
      if (generation == _generation) failure = _safe(error);
    } finally {
      if (generation == _generation) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> select(String id) async {
    final selection = ++_selection;
    final generation = _generation;
    _stopPolling();
    selectedId = id;
    selectedSession = null;
    lastAnswer = null;
    failure = null;
    detailLoading = true;
    processing = false;
    asking = false;
    _notify();
    try {
      final session = await get(id);
      if (generation == _generation && selection == _selection) {
        selectedSession = session;
        _syncPolling();
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
      }
    } finally {
      if (generation == _generation && selection == _selection) {
        detailLoading = false;
        _notify();
      }
    }
  }

  Future<void> refreshSelected() async {
    final id = selectedId;
    final generation = _generation;
    final selection = _selection;
    if (id == null || detailLoading) return;
    try {
      final session = await get(id);
      if (generation == _generation && selection == _selection) {
        selectedSession = session;
        _syncPolling();
        _notify();
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
        _stopPolling();
        _notify();
      }
    }
  }

  Future<void> process({
    required bool consent,
    bool retryAmbiguous = false,
  }) async {
    final session = selectedSession;
    if (!consent || processing || session == null) return;
    final generation = _generation;
    final selection = _selection;
    processing = true;
    failure = null;
    _notify();
    try {
      final updated = await processor(
        session.id,
        consent: true,
        retryAmbiguous: retryAmbiguous,
      );
      if (generation == _generation && selection == _selection) {
        selectedSession = updated;
        _syncPolling();
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
        await refreshSelected();
      }
    } finally {
      if (generation == _generation && selection == _selection) {
        processing = false;
        _notify();
      }
    }
  }

  Future<void> cancelProcessing() async {
    final session = selectedSession;
    if (session == null || processing) return;
    final generation = _generation;
    final selection = _selection;
    processing = true;
    failure = null;
    _notify();
    try {
      final updated = await cancel(session.id);
      if (generation == _generation && selection == _selection) {
        selectedSession = updated;
        _syncPolling();
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
      }
    } finally {
      if (generation == _generation && selection == _selection) {
        processing = false;
        _notify();
      }
    }
  }

  Future<void> ask(String question, {required bool consent}) async {
    final session = selectedSession;
    final trimmed = question.trim();
    if (!consent ||
        asking ||
        session == null ||
        session.job.transcripts.isEmpty ||
        trimmed.isEmpty ||
        trimmed.length > 2000) {
      return;
    }
    final generation = _generation;
    final selection = _selection;
    asking = true;
    lastAnswer = null;
    failure = null;
    _notify();
    try {
      final result = await answer(session.id, trimmed, consent: true);
      if (generation == _generation && selection == _selection) {
        lastAnswer = result;
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
      }
    } finally {
      if (generation == _generation && selection == _selection) {
        asking = false;
        _notify();
      }
    }
  }

  void closeDetail() {
    _selection++;
    _stopPolling();
    selectedId = null;
    selectedSession = null;
    lastAnswer = null;
    failure = null;
    detailLoading = false;
    processing = false;
    asking = false;
    _notify();
  }

  void clear() {
    _generation++;
    _selection++;
    _stopPolling();
    sessions = [];
    cursor = null;
    selectedId = null;
    selectedSession = null;
    lastAnswer = null;
    failure = null;
    loading = false;
    detailLoading = false;
    processing = false;
    asking = false;
    _notify();
  }

  bool get _shouldPoll => switch (selectedSession?.job.status) {
    SessionJobStatus.queued ||
    SessionJobStatus.transcribing ||
    SessionJobStatus.summarizing => true,
    _ => false,
  };

  void _syncPolling() {
    if (_shouldPoll) {
      _pollTimer ??= timerFactory(pollingInterval, () {
        unawaited(refreshSelected());
      });
    } else {
      _stopPolling();
    }
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  CompanionFailure _safe(Object error) => error is CompanionFailure
      ? error
      : const CompanionFailure('REQUEST_FAILED');

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _stopPolling();
    super.dispose();
  }
}

Timer _periodicTimer(Duration duration, void Function() callback) =>
    Timer.periodic(duration, (_) => callback());
