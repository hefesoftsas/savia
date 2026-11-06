import 'package:flutter/foundation.dart';

import 'models.dart';

typedef ListRecordings = Future<RecordingPage> Function({String? cursor});

class RecordingsController extends ChangeNotifier {
  RecordingsController({
    required this._list,
    required this._notes,
    required this._generate,
    required this._answer,
  });
  final ListRecordings _list;
  final Future<RecordingNotes> Function(String) _notes, _generate;
  final Future<RecordingAnswer> Function(String, String) _answer;
  List<Recording> recordings = [];
  String? cursor, selectedId;
  RecordingNotes? savedNotes;
  RecordingAnswer? answer;
  CompanionFailure? failure;
  bool loading = false, detailLoading = false, processing = false;
  int _generation = 0, _selection = 0;
  bool _disposed = false;
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
      final page = await _list(cursor: more ? cursor : null);
      if (generation != _generation) return;
      recordings = more ? [...recordings, ...page.recordings] : page.recordings;
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
    selectedId = id;
    savedNotes = null;
    answer = null;
    failure = null;
    detailLoading = true;
    processing = false;
    _notify();
    try {
      final result = await _notes(id);
      if (generation == _generation && selection == _selection) {
        savedNotes = result;
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

  Future<void> generate({required bool consent}) async {
    if (!consent || processing || selectedId == null) return;
    final generation = _generation, selection = _selection;
    final id = selectedId!;
    processing = true;
    failure = null;
    _notify();
    try {
      final result = await _generate(id);
      if (generation == _generation && selection == _selection) {
        savedNotes = result;
      }
    } catch (error) {
      if (generation == _generation && selection == _selection) {
        failure = _safe(error);
        // Transcription may have persisted before a summary provider failed.
        try {
          final recovered = await _notes(id);
          if (generation == _generation && selection == _selection) {
            savedNotes = recovered;
          }
        } catch (_) {
          /* Keep any already saved transcript and the original failure. */
        }
      }
    } finally {
      if (generation == _generation && selection == _selection) {
        processing = false;
        _notify();
      }
    }
  }

  Future<void> ask(String question, {required bool consent}) async {
    if (!consent ||
        processing ||
        selectedId == null ||
        savedNotes?.transcript == null ||
        question.trim().isEmpty) {
      return;
    }
    final generation = _generation, selection = _selection;
    processing = true;
    failure = null;
    answer = null;
    _notify();
    try {
      final result = await _answer(selectedId!, question.trim());
      if (generation == _generation && selection == _selection) answer = result;
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

  void closeDetail() {
    _selection++;
    selectedId = null;
    savedNotes = null;
    answer = null;
    processing = false;
    detailLoading = false;
    failure = null;
    _notify();
  }

  void clear() {
    _generation++;
    _selection++;
    recordings = [];
    cursor = null;
    selectedId = null;
    savedNotes = null;
    answer = null;
    failure = null;
    loading = false;
    detailLoading = false;
    processing = false;
    _notify();
  }

  CompanionFailure _safe(Object error) => error is CompanionFailure
      ? error
      : const CompanionFailure('REQUEST_FAILED');
  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
