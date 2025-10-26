import React, { useState, useEffect } from 'react'
import { Badge, List, Empty, Button, Typography, Tag, Popover } from 'antd'
import { BellOutlined, ClockCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const NotificationCenter = () => {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 60000) // reduce polling to 60s
    return () => clearInterval(interval)
  }, [])

  const fetchNotifications = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/notifications')
      const data = await response.json()
      if (data.ok) {
        setNotifications(data.notifications)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnreadCount = async () => {
    try {
      const response = await fetch('/api/notifications/unread-count')
      const data = await response.json()
      if (data.ok) {
        setUnreadCount(data.count)
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error)
    }
  }

  const markAsRead = async (notificationId) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, { method: 'PATCH' })
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId ? { ...notif, is_read: true } : notif
        )
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Failed to mark as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'PATCH' })
      setNotifications(prev => prev.map(notif => ({ ...notif, is_read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Failed to mark all as read:', error)
    }
  }

  const getNotificationColor = (type) => {
    const colors = {
      offer_submitted: 'blue',
      offer_approved: 'green',
      offer_rejected: 'red',
      block_request: 'orange',
      block_approved: 'green',
      block_expired: 'gray',
      reservation_created: 'purple',
      reservation_approved: 'green',
      contract_ready: 'blue'
    }
    return colors[type] || 'default'
  }

  const getNotificationIcon = (type) => {
    const icons = {
      offer_submitted: '📄',
      offer_approved: '✅',
      offer_rejected: '❌',
      block_request: '🏢',
      block_approved: '✅',
      block_expired: '⏰',
      reservation_created: '📋',
      reservation_approved: '✅',
      contract_ready: '📝'
    }
    return icons[type] || '📢'
  }

  const notificationMenu = (
    <div style={{ width: 350, maxHeight: 500, overflow: 'auto' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>Notifications</Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={markAllAsRead}>
            Mark all as read
          </Button>
        )}
      </div>
      <List
        dataSource={notifications}
        loading={loading}
        locale={{ emptyText: <Empty description="No notifications" /> }}
        renderItem={item => (
          <List.Item
            style={{ 
              backgroundColor: item.is_read ? 'transparent' : '#f6ffed',
              padding: '12px 16px',
              cursor: 'pointer'
            }}
            onClick={() => {
              if (!item.is_read) markAsRead(item.id)
              if (item.ref_table && item.ref_id) {
                window.location.href = `/${item.ref_table}/${item.ref_id}`
              }
            }}
          >
            <List.Item.Meta
              avatar={<span style={{ fontSize: '20px' }}>{getNotificationIcon(item.type)}</span>}
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <Text strong>{item.message}</Text>
                  <Tag color={getNotificationColor(item.type)}>{String(item.type || '').replace('_', ' ')}</Tag>
                </div>
              }
              description={
                <div>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    <ClockCircleOutlined /> {new Date(item.created_at).toLocaleString()}
                  </Text>
                  {item.ref_title && (
                    <div>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        Related: {item.ref_title}
                      </Text>
                    </div>
                  )}
                </div>
              }
            />
          </List.Item>
        )}
      />
      {notifications.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
          <Button type="link" onClick={() => window.location.href = '/notifications'}>
            View all notifications
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="notification-center">
      <Popover
        content={notificationMenu}
        trigger="click"
        open={visible}
        onOpenChange={(open) => {
          setVisible(open)
          if (open) {
            fetchNotifications()
          }
        }}
        placement="bottomRight"
      >
        <Badge count={unreadCount} offset={[10, 0]} showZero={false}>
          <Button
            type="text"
            icon={<BellOutlined style={{ fontSize: '18px' }} />}
          />
        </Badge>
      </Popover>
    </div>
  )
}

export default NotificationCenter