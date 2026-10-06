import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import 'config.dart';
import 'capture/capture_controller.dart';
import 'capture/native_capture.dart';
import 'capture/document_import.dart';
import 'capture/temp_files.dart';
import 'capture/audio_segmenter.dart';
import 'capture/session_uploader.dart';
import 'session/session_controller.dart';
import 'session/oauth_adapter.dart';
import 'session/secure_session_store.dart';
import 'recordings/recordings_api.dart';
import 'recordings/recordings_controller.dart';
import 'recordings/recording_sessions_controller.dart';
import 'recordings/session_models.dart';
import 'recordings/models.dart';
import 'playback/audio_player_adapter.dart';
import 'playback/playback_controller.dart';
import 'l10n/app_localizations.dart';
import 'screens/connect_screen.dart';
import 'screens/capture_screen.dart';
import 'screens/library_screen.dart';
import 'screens/recording_detail_screen.dart';
import 'screens/recording_session_detail_screen.dart';

class CompanionBootstrap extends StatefulWidget {
  const CompanionBootstrap({super.key, required this.config});
  final MobileConfig config;
  @override
  State<CompanionBootstrap> createState() => _CompanionBootstrapState();
}

class _CompanionBootstrapState extends State<CompanionBootstrap> {
  late Future<MobileServices> services = MobileServices.create(widget.config);
  @override
  Widget build(BuildContext context) => FutureBuilder<MobileServices>(
    future: services,
    builder: (context, snapshot) {
      if (snapshot.hasData) {
        return MobileHome(config: widget.config, services: snapshot.data!);
      }
      final l = AppLocalizations.of(context)!;
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: snapshot.hasError
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(l.errorGeneric),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () => setState(() {
                            services = MobileServices.create(widget.config);
                          }),
                          child: Text(l.refresh),
                        ),
                      ],
                    )
                  : const CircularProgressIndicator(),
            ),
          ),
        ),
      );
    },
  );
}

class MobileServices {
  MobileServices({
    required this.session,
    required this.api,
    required this.capture,
    required this.recordings,
    required this.sessions,
    required this.files,
  });
  final SessionController session;
  final RecordingsApi api;
  final CaptureController capture;
  final RecordingsController recordings;
  final RecordingSessionsController sessions;
  final TempFiles files;
  Future<void> close() async {
    session.dispose();
    recordings.dispose();
    sessions.dispose();
    await capture.shutdown();
    capture.dispose();
  }

  static Future<MobileServices> create(MobileConfig config) async {
    final files = await TempFiles.create();
    await files.clearOrphans();
    final importer = SystemDocumentImport();
    await importer.clearPickerCache();
    late final SessionController session;
    final api = RecordingsApi(
      dio: Dio(BaseOptions(connectTimeout: const Duration(seconds: 20))),
      apiOrigin: config.apiOrigin,
      tokenProvider: () => session.accessToken(),
      workspaceIdProvider: () => session.selectedWorkspace?.id,
    );
    session = SessionController(
      config: config,
      oauth: AppAuthOAuthAdapter(config: config),
      store: DeviceSecureSessionStore(),
      discover: (token) => api.session(accessToken: token),
    );
    final recordings = RecordingsController(
      list: ({cursor}) => api.list(cursor: cursor),
      notes: api.notes,
      generate: (id) => api.generate(id, consent: true),
      answer: (id, question) => api.answer(id, question, consent: true),
    );
    final sessions = RecordingSessionsController(
      list: api.listSessions,
      get: api.getSession,
      process: api.processSession,
      cancel: api.cancelSession,
      answer: api.answerSession,
      renamer: api.renameSession,
    );
    final sessionUploader = CapturedSessionUploader(
      api: api,
      segmenter: const MethodChannelAudioSegmenter(),
      files: files,
    );
    final capture = CaptureController(
      native: MicrophoneCapture(),
      importer: importer,
      files: files,
      uploader: (draft, cancel, progress) async {
        if (draft.isCapture) {
          await sessionUploader.upload(
            draft,
            cancellation: cancel,
            onProgress: progress,
          );
        } else {
          await api.upload(draft, cancellation: cancel, onProgress: progress);
        }
      },
    );
    return MobileServices(
      session: session,
      api: api,
      capture: capture,
      recordings: recordings,
      sessions: sessions,
      files: files,
    );
  }
}

class MobileHome extends StatefulWidget {
  const MobileHome({super.key, required this.config, required this.services});
  final MobileConfig config;
  final MobileServices services;
  @override
  State<MobileHome> createState() => _MobileHomeState();
}

class _MobileHomeState extends State<MobileHome> with WidgetsBindingObserver {
  bool connecting = true, signingOut = false;
  int tab = 0, generation = 0;
  Recording? selected;
  String? selectedSessionId;
  PlaybackController? playback;
  CompanionFailure? failure;
  MobileServices get s => widget.services;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    s.session.addListener(_sessionChanged);
    unawaited(_restore());
  }

  Future<void> _restore() async {
    try {
      if (widget.config.isConfigured) {
        await s.session.restore();
        failure = null;
      }
    } on SessionRequired {
      failure = const CompanionFailure('SESSION_REQUIRED', status: 401);
    } on SessionFailure {
      failure = const CompanionFailure('SESSION_UNAVAILABLE');
    } catch (_) {
      failure = const CompanionFailure('SESSION_UNAVAILABLE');
    }
    if (mounted) setState(() => connecting = false);
  }

  Future<void> _retryRestore() async {
    setState(() {
      connecting = true;
      failure = null;
    });
    await _restore();
  }

  void _sessionChanged() {
    final changed = s.session.generation != generation;
    if (changed) {
      generation = s.session.generation;
      s.recordings.clear();
      s.sessions.clear();
      selected = null;
      selectedSessionId = null;
      unawaited(playback?.close());
      playback = null;
      unawaited(s.capture.clear());
    }
    if (mounted) setState(() {});
    if (s.session.selectedWorkspace != null &&
        ((!s.recordings.loading && s.recordings.recordings.isEmpty) ||
            (!s.sessions.loading && s.sessions.sessions.isEmpty))) {
      unawaited(_reload());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      unawaited(s.capture.onBackground());
      unawaited(playback?.pause());
    }
  }

  Future<void> _connect() async {
    setState(() {
      connecting = true;
      failure = null;
    });
    try {
      await s.session.signIn();
    } catch (_) {
      failure = const CompanionFailure('SIGN_IN_FAILED');
    }
    if (mounted) setState(() => connecting = false);
  }

  Future<void> _logout() async {
    if (signingOut) return;
    setState(() => signingOut = true);
    final previousPlayback = playback;
    final result = await s.session.signOut();
    await previousPlayback?.close();
    await s.capture.clear();
    s.recordings.clear();
    s.sessions.clear();
    if (!mounted) return;
    setState(() {
      selected = null;
      playback = null;
      tab = 0;
      signingOut = false;
    });
    if (result.revocationWarning) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context)!.revokeWarning)),
      );
    }
  }

  Future<void> _reload() async {
    await Future.wait([s.recordings.reload(), s.sessions.reload()]);
    await s.capture.reconcile({
      ...s.recordings.recordings.map((r) => r.id),
      ...s.sessions.sessions
          .where((session) => session.state == RecordingSessionState.ready)
          .map((session) => session.id),
    });
  }

  void _selectSession(String id) {
    unawaited(playback?.close());
    setState(() {
      selectedSessionId = id;
      selected = null;
      playback = PlaybackController(
        player: NativeAudioPlayer(),
        files: s.files,
        download: (recordingId, path, cancel) =>
            s.api.audio(recordingId, path, cancellation: cancel),
      );
    });
    unawaited(s.sessions.select(id));
  }

  void _select(Recording recording) {
    s.sessions.closeDetail();
    unawaited(playback?.close());
    setState(() {
      selectedSessionId = null;
      selected = recording;
      playback = PlaybackController(
        player: NativeAudioPlayer(),
        files: s.files,
        download: (id, path, cancel) =>
            s.api.audio(id, path, cancellation: cancel),
      );
    });
    unawaited(s.recordings.select(recording.id));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    s.session.removeListener(_sessionChanged);
    unawaited(playback?.close());
    unawaited(s.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context)!;
    if (s.session.session == null) {
      return ConnectScreen(
        config: widget.config,
        onConnect: _connect,
        onRestore: _retryRestore,
        failure: failure,
        canRestore: s.session.canRestore,
        busy: connecting,
      );
    }
    final account = s.session.session!;
    final workspace = s.session.selectedWorkspace;
    final canUpload = account.grantedRecordingScopes.contains(
      'recordings:upload',
    );
    final canProcess = account.grantedRecordingScopes.contains(
      'recordings:process',
    );
    return Scaffold(
      appBar: AppBar(
        title: const Text('Savia Companion'),
        actions: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Text('Preview'),
          ),
          IconButton(
            tooltip: l.signOut,
            onPressed: signingOut ? null : _logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 4, 24, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(account.displayName),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<int>(
                        initialValue: workspace?.id,
                        decoration: InputDecoration(labelText: l.workspace),
                        isExpanded: true,
                        items: account.workspaces
                            .map(
                              (w) => DropdownMenuItem(
                                value: w.id,
                                child: Text(
                                  w.name,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged:
                            s.capture.busy ||
                                s.capture.draft != null ||
                                s.capture.phase == CapturePhase.recording
                            ? null
                            : (id) async {
                                if (id == null) return;
                                await s.capture.clear();
                                await s.session.setWorkspace(
                                  account.workspaces.firstWhere(
                                    (w) => w.id == id,
                                  ),
                                );
                              },
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: workspace == null
                      ? Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(l.noWorkspace),
                        )
                      : selectedSessionId != null
                      ? RecordingSessionDetailScreen(
                          key: ValueKey('${workspace.id}/$selectedSessionId'),
                          controller: s.sessions,
                          playback: playback!,
                          downloadChunk:
                              (sessionId, source, sequence, path, cancel) =>
                                  s.api.sessionChunkAudio(
                                    sessionId,
                                    source,
                                    sequence,
                                    path,
                                    cancellation: cancel,
                                  ),
                          canProcess: canProcess,
                          onClose: () {
                            s.sessions.closeDetail();
                            unawaited(playback?.close());
                            setState(() {
                              selectedSessionId = null;
                              playback = null;
                            });
                          },
                        )
                      : selected != null
                      ? RecordingDetailScreen(
                          key: ValueKey('${workspace.id}/${selected!.id}'),
                          recording: selected!,
                          controller: s.recordings,
                          playback: playback!,
                          canProcess: canProcess,
                          onClose: () {
                            s.recordings.closeDetail();
                            setState(() {
                              selected = null;
                              playback = null;
                            });
                          },
                        )
                      : tab == 0
                      ? LibraryScreen(
                          controller: s.recordings,
                          sessions: s.sessions,
                          onSelect: _select,
                          onSelectSession: _selectSession,
                          onRefresh: _reload,
                        )
                      : CaptureScreen(
                          controller: s.capture,
                          canUpload: canUpload,
                          onUploaded: () {
                            setState(() => tab = 0);
                            unawaited(_reload());
                          },
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: selected != null || selectedSessionId != null
          ? null
          : NavigationBar(
              selectedIndex: tab,
              onDestinationSelected: (value) => setState(() => tab = value),
              destinations: [
                NavigationDestination(
                  icon: const Icon(Icons.library_music_outlined),
                  label: l.library,
                ),
                NavigationDestination(
                  icon: const Icon(Icons.mic_none),
                  label: l.capture,
                ),
              ],
            ),
    );
  }
}
