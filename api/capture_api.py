# coding: utf-8
"""
HTTP捕捉 API - 内存模式
流量数据存储在内存中，最多200条，多了自减
与数据库存储的traffic_api不冲突
"""
from flask import Blueprint, jsonify, request
import threading
import time
import uuid
from collections import OrderedDict
from service.Class_Core_Function import Class_Core_Function

capture_api = Blueprint('capture_api', __name__)

_socketio_instance = None
_core = Class_Core_Function()

def init_capture_socketio(socketio):
    global _socketio_instance
    _socketio_instance = socketio


MAX_CAPTURE_SIZE = 200
_capture_lock = threading.Lock()
_capture_data = OrderedDict()


class CaptureStorage:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._data = OrderedDict()
                cls._instance._max_size = MAX_CAPTURE_SIZE
                cls._instance._data_lock = threading.Lock()
            return cls._instance

    def add(self, item):
        with self._data_lock:
            item_id = str(uuid.uuid4())
            item['_id'] = item_id
            item['captured_at'] = _core.callback_time(2)
            self._data[item_id] = item
            popped_id = None
            while len(self._data) > self._max_size:
                _, popped = self._data.popitem(last=False)
                popped_id = popped.get('_id')
        threading.Thread(target=self._async_emit, args=(item, item_id, popped_id), daemon=True).start()
        return item_id

    def _async_emit(self, item, item_id, popped_id):
        try:
            if not _socketio_instance:
                return
            url = item.get('url', '')
            emit_data = {
                'item': {
                    '_id': item_id,
                    'url': url,
                    'method': item.get('method', ''),
                    'status_code': item.get('status_code', ''),
                    'content_type': item.get('content_type', ''),
                    'server': item.get('server', ''),
                    'time': item.get('captured_at', ''),
                    'response_time': item.get('response_time', ''),
                    'extension': _core.callback_file_extensions(url) or '',
                },
                'removed_id': popped_id,
                'total': self.count(),
            }
            _socketio_instance.emit('capture_new', emit_data)
            if self._check_project_filter(url):
                _socketio_instance.emit('capture_new_filtered', emit_data)
        except Exception:
            pass

    def _check_project_filter(self, url):
        try:
            from service.Class_check import class_check
            checker = class_check()
            if not checker.check_traffic_url(url):
                return False
            if not checker.check_url(url):
                return False
            return True
        except Exception:
            return False

    def get_all(self):
        with self._data_lock:
            return list(self._data.values())

    def get_by_id(self, item_id):
        with self._data_lock:
            return self._data.get(item_id)

    def delete_by_id(self, item_id):
        with self._data_lock:
            if item_id in self._data:
                del self._data[item_id]
                return True
            return False

    def clear(self):
        with self._data_lock:
            self._data.clear()
        try:
            if _socketio_instance:
                _socketio_instance.emit('capture_cleared', {})
        except Exception:
            pass

    def count(self):
        with self._data_lock:
            return len(self._data)


_storage = CaptureStorage()


@capture_api.route('/api/capture/list', methods=['GET'])
def get_capture_list():
    use_filter = request.args.get('filter', '') == 'project'

    items = _storage.get_all()
    checker = None
    if use_filter:
        try:
            from service.Class_check import class_check
            checker = class_check()
        except Exception:
            checker = None

    result = []
    for item in items:
        url = item.get('url', '')
        if checker:
            if not checker.check_traffic_url(url):
                continue
            if not checker.check_url(url):
                continue
        result.append({
            '_id': item.get('_id'),
            'url': url,
            'method': item.get('method', ''),
            'status_code': item.get('status_code', ''),
            'content_type': item.get('content_type', ''),
            'server': item.get('server', ''),
            'time': item.get('captured_at', ''),
            'response_time': item.get('response_time', ''),
            'extension': _core.callback_file_extensions(url) or '',
        })
    result.reverse()
    return jsonify({'success': True, 'data': result, 'count': len(result)})


@capture_api.route('/api/capture/detail/<item_id>', methods=['GET'])
def get_capture_detail(item_id):
    item = _storage.get_by_id(item_id)
    if not item:
        return jsonify({'success': False, 'message': '数据不存在'})
    return jsonify({'success': True, 'data': item})


@capture_api.route('/api/capture/delete/<item_id>', methods=['POST'])
def delete_capture(item_id):
    result = _storage.delete_by_id(item_id)
    if result:
        return jsonify({'success': True, 'message': '删除成功'})
    return jsonify({'success': False, 'message': '数据不存在'})


@capture_api.route('/api/capture/clear', methods=['POST'])
def clear_capture():
    _storage.clear()
    return jsonify({'success': True, 'message': '已清空所有捕捉数据'})


@capture_api.route('/api/capture/count', methods=['GET'])
def get_capture_count():
    return jsonify({'success': True, 'count': _storage.count()})


@capture_api.route('/api/capture/add', methods=['POST'])
def add_capture():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'success': False, 'message': '数据为空'})
    item_id = _storage.add(data)
    return jsonify({'success': True, 'id': item_id})


def add_capture_item(item):
    return _storage.add(item)
