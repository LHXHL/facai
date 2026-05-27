# coding: utf-8
import nmap
from typing import Any, Dict


def _get_socks5_proxy():
    try:
        from service.Class_Core_Function import Class_Core_Function
        return Class_Core_Function().callback_socks5_proxy()
    except Exception:
        return None


def port_scan(target: str, args: str = '', ports: str = '') -> Dict[str, Any]:
    """
    使用nmap进行端口扫描
    
    Args:
        target (str): 目标IP地址或域名
        args (str): nmap扫描参数，如 "-sV -O"
        ports (str): 端口范围，如 "80,443,8080-8090"
    
    Returns:
        Dict: 扫描结果，包含:
            - target: 扫描目标
            - args: 使用的参数
            - ports: 扫描的端口
            - results: 端口扫描结果列表
            - raw_output: 原始输出
            - error: 错误信息（如果有）
    """
    try:
        nm = nmap.PortScanner()
        
        scan_args = args if args else '-sV'
        
        command = f'{scan_args} -p {ports}'

        proxy = _get_socks5_proxy()
        if proxy:
            command += f' --proxies {proxy}'
        
        nm.scan(target, arguments=command)
        
        results = []
        
        for host in nm.all_hosts():
            if 'status' not in nm[host]:
                continue
                
            if 'tcp' in nm[host]:
                for port, port_info in nm[host]['tcp'].items():
                    result = {
                        'ip': host,
                        'port': port,
                        'status': port_info.get('state', 'unknown'),
                        'protocol': 'tcp',
                        'service': port_info.get('name', ''),
                        'version': port_info.get('version', '')
                    }
                    results.append(result)
            
            if 'udp' in nm[host]:
                for port, port_info in nm[host]['udp'].items():
                    result = {
                        'ip': host,
                        'port': port,
                        'status': port_info.get('state', 'unknown'),
                        'protocol': 'udp',
                        'service': port_info.get('name', ''),
                        'version': port_info.get('version', '')
                    }
                    results.append(result)
        
        raw_output = nm.get_nmap_last_output()
        if isinstance(raw_output, bytes):
            try:
                raw_output = raw_output.decode('utf-8')
            except UnicodeDecodeError:
                raw_output = raw_output.decode('utf-8', errors='replace')
        
        return {
            'target': target,
            'args': args,
            'ports': ports,
            'results': results,
            'raw_output': raw_output
        }
        
    except Exception as e:
        return {
            'error': f'nmap扫描失败: {str(e)}',
            'target': target,
            'args': args,
            'ports': ports,
            'results': []
        }
